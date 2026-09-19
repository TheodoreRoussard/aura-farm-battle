// Test de charge : N joueurs simulés, chacun avec son wallet jetable, qui tapent pendant S secondes.
// C'est le go / no-go du projet : il valide la gestion des nonces, le débit RPC, les limites de
// gas et le budget MON AVANT d'écrire la moindre interface.
//
//   pnpm load -- --local --players 20 --seconds 30
//   pnpm load -- --players 5 --seconds 10            (testnet : ~1 MON)
//
// Options : --interval 300 (ms entre deux envois par joueur) --max 8 (taps max par tx)
//           --fund 0.25 (MON par joueur ; le reste est renvoyé à l'admin à la fin)
import { encodeFunctionData, formatEther, parseEther } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ABI, BLOCK_MS, GAS } from '../shared/config.mjs'
import { openFeed } from '../shared/feed.mjs'
import { TxPump } from '../shared/pump.mjs'
import { arg, getAdmin, getClients, getNetwork, loadDeployment, sleep } from './lib.mjs'

const net = getNetwork()
const N = Number(arg('players', 10))
const SECONDS = Number(arg('seconds', 15))
const INTERVAL = Number(arg('interval', 300))
const MAX_COUNT = Number(arg('max', 8))
const admin = getAdmin(net)
const { publicClient } = getClients(net, admin)
const farm = loadDeployment(net).address
const call = (functionName, args = []) => encodeFunctionData({ abi: ABI, functionName, args })

const expectedTx = Math.ceil((SECONDS * 1000) / INTERVAL)
const perTx = Number(GAS.tap) * 150e-9 // pire cas : le solde doit couvrir limite × maxFee (1,5 × base)
const defaultFund = (Number(GAS.join) * 150e-9 + expectedTx * perTx * 1.15 + 0.01).toFixed(3)
const FUND = parseEther(String(arg('fund', defaultFund)))

const adminBefore = await publicClient.getBalance({ address: admin.address })
console.log(`Réseau ${net.chain.name} — contrat ${farm}`)
console.log(`${N} joueurs × ${SECONDS} s, 1 tx / ${INTERVAL} ms → ~${N * expectedTx} tx attendues`)
console.log(`Admin ${admin.address} : ${formatEther(adminBefore)} MON — dotation ${formatEther(FUND)} MON/joueur\n`)
if (adminBefore < FUND * BigInt(N) + parseEther('0.05')) {
  console.error('Solde admin insuffisant pour ce test. Réduis --players / --seconds.')
  process.exit(1)
}

const mkPump = (account) => new TxPump({ account, chainId: net.chain.id, rpcUrls: net.http }).init()
const adminPump = await mkPump(admin)
const players = await Promise.all(
  Array.from({ length: N }, async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    return { account, pump: await mkPump(account), tapsSent: 0, tapsSeen: 0n }
  }),
)
const byAddress = new Map(players.map((p) => [p.account.address.toLowerCase(), p]))

// ── 1. Dotation : l'admin enchaîne N transferts sans attendre les reçus ──────────────
console.log('1/5 dotation des wallets...')
for (const p of players) await adminPump.send({ to: p.account.address, value: FUND, gas: GAS.transfer })
if (!(await adminPump.drain())) throw new Error('dotation non confirmée')
// Règle Monad : un compte fraîchement alimenté doit attendre k = 3 blocs avant de dépenser
// (le consensus valide les soldes sur un état en retard de 3 blocs).
await sleep(BLOCK_MS * 5)

// ── 2. Inscription ───────────────────────────────────────────────────────────────────
console.log('2/5 join()...')
for (const p of players) await p.pump.send({ to: farm, data: call('join'), gas: GAS.join })
await Promise.all(players.map((p) => p.pump.drain()))
const joined = await publicClient.readContract({ address: farm, abi: ABI, functionName: 'rosterLength' })
console.log(`    roster on-chain : ${joined} joueurs`)

// ── 3. Flux temps réel : mesure de la latence envoi → log vu / finalisé ──────────────
const latFirst = []
const latFinal = []
const sentAt = new Map()
let roundInfo = null
const feed = openFeed({
  wsUrl: net.ws,
  address: farm,
  monad: net.monadSubscriptions,
  onEvent: ({ name, args, log, state, first }) => {
    if (name === 'RoundStarted') roundInfo = args
    if (name !== 'PlayerUpdated') return
    const p = byAddress.get(args.player.toLowerCase())
    if (!p) return
    if (first) {
      const ms = p.pump.seen(log.transactionHash)
      if (ms !== null) {
        latFirst.push(ms)
        sentAt.set(log.transactionHash, Date.now() - ms)
      }
      if (args.total > p.tapsSeen) p.tapsSeen = args.total
    }
    if ((state === 'Finalized' || !net.monadSubscriptions) && sentAt.has(log.transactionHash)) {
      latFinal.push(Date.now() - sentAt.get(log.transactionHash))
      sentAt.delete(log.transactionHash)
    }
  },
})
await sleep(800)

// ── 4. Round ─────────────────────────────────────────────────────────────────────────
const durationBlocks = Math.ceil((SECONDS * 1000) / BLOCK_MS) + 20
console.log(`3/5 startRound(10, ${durationBlocks}, 20)...`)
await adminPump.send({ to: farm, data: call('startRound', [10, durationBlocks, 20]), gas: 60_000n })
await adminPump.drain()
const g = await publicClient.readContract({ address: farm, abi: ABI, functionName: 'game' })
while ((await publicClient.getBlockNumber()) < BigInt(g[1])) await sleep(100)

console.log(`4/5 ${SECONDS} s de taps...`)
const t0 = Date.now()
await Promise.all(
  players.map(async (p, i) => {
    await sleep((INTERVAL * i) / N) // les joueurs ne tapent pas tous au même instant
    while (Date.now() - t0 < SECONDS * 1000) {
      const count = 1 + Math.floor(Math.random() * MAX_COUNT)
      p.tapsSent += count
      p.pump.send({ to: farm, data: call('tap', [count]), gas: GAS.tap, meta: { count } }).catch(() => {})
      await sleep(INTERVAL)
    }
  }),
)
const elapsed = (Date.now() - t0) / 1000
console.log('    envoi terminé, attente des dernières inclusions...')
await Promise.all(players.map((p) => p.pump.drain(20000)))
await sleep(2500) // le temps que les derniers blocs passent Finalized

// ── 5. Bilan ─────────────────────────────────────────────────────────────────────────
const sum = (f) => players.reduce((a, p) => a + f(p), 0)
const signed = sum((p) => p.pump.stats.signed) - N // hors join()
const landed = sum((p) => p.pump.stats.landed) - N
const pct = (arr, q) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * q))] : NaN)
const errors = {}
for (const p of players) for (const [k, v] of Object.entries(p.pump.stats.rpcErrors)) errors[k] = (errors[k] ?? 0) + v

const onchain = await publicClient.readContract({ address: farm, abi: ABI, functionName: 'snapshot', args: [0n, 1000n] })
let onchainTaps = 0n
onchain[2].forEach((addr, i) => {
  if (byAddress.has(addr.toLowerCase()) && onchain[3][i].round === g[0]) onchainTaps += BigInt(onchain[3][i].total)
})

console.log('\n5/5 bilan')
console.table({
  'tx tap signées': signed,
  'tx incluses (nonce consommé)': landed,
  'tx vues via les logs (succès)': latFirst.length,
  'tx incluses mais sans log (revert)': landed - latFirst.length,
  'tx renvoyées par le chien de garde': sum((p) => p.pump.stats.resent),
  'tx abandonnées': sum((p) => p.pump.stats.dropped),
  'débit moyen (tx/s)': +(latFirst.length / elapsed).toFixed(1),
  'taps envoyés': sum((p) => p.tapsSent),
  'taps comptés on-chain': Number(onchainTaps),
  'appels RPC / joueur / s': +(sum((p) => p.pump.stats.rpcCalls) / N / elapsed).toFixed(1),
})
console.log(`Latence envoi → 1er log (Proposed) : p50 ${pct(latFirst, 0.5)} ms · p95 ${pct(latFirst, 0.95)} ms`)
console.log(`Latence envoi → Finalized          : p50 ${pct(latFinal, 0.5)} ms · p95 ${pct(latFinal, 0.95)} ms`)
if (Object.keys(errors).length) console.log('Erreurs RPC :', errors)

// Rapatriement des fonds restants. Un compte sous 10 MON ne peut envoyer de la VALEUR que s'il
// n'a émis aucune tx depuis 3 blocs ("emptying transaction") : le sleep ci-dessus y pourvoit.
feed.close()
console.log('\nRapatriement des MON restants vers l\'admin...')
await Promise.all(
  players.map(async (p) => {
    const bal = await p.pump.balance()
    const fee = GAS.transfer * p.pump._maxFee()
    if (bal > fee) await p.pump.send({ to: admin.address, value: bal - fee, gas: GAS.transfer })
    await p.pump.drain()
    p.pump.stop()
  }),
)
adminPump.stop()
await sleep(1000)
const adminAfter = await publicClient.getBalance({ address: admin.address })
const spent = Number(formatEther(adminBefore - adminAfter))
console.log(`Coût total du test : ${spent.toFixed(4)} MON → ${(spent / Math.max(1, latFirst.length)).toFixed(5)} MON par tx réussie`)
console.log(`Au tarif du testnet (limite ${GAS.tap} gas × 100 gwei) ces ${signed} tx coûteraient ${(signed * Number(GAS.tap) * 100e-9).toFixed(2)} MON`)
console.log(`Extrapolation : 30 joueurs × 30 s à ce rythme ≈ ${(((spent / Math.max(1, N)) * 30 * 30) / SECONDS).toFixed(1)} MON par round`)
process.exit(0)
