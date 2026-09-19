// Serveur unique d'Aura Farm Battle. Il n'est PAS sur le chemin des taps (les téléphones
// envoient leurs transactions directement au RPC) : s'il tombe, le jeu continue. Il fait 3 choses :
//   1. distributeur de MON (la clé admin ne quitte jamais ce processus — jamais de VITE_*) ;
//   2. indexeur en mémoire : une seule souscription monadLogs, rediffusée aux clients par WebSocket ;
//   3. régie : lancer / arrêter un round depuis l'écran géant.
// À héberger sur une machine qui reste allumée (laptop + cloudflared, Railway...) : pas en serverless.
import http from 'node:http'
import { encodeFunctionData, formatEther, isAddress, parseEther } from 'viem'
import { WebSocketServer } from 'ws'
import { ABI, DRIP_ABI, GAS, dripGas } from '../shared/config.mjs'
import { openFeed } from '../shared/feed.mjs'
import { nameOf } from '../shared/names.mjs'
import { TxPump } from '../shared/pump.mjs'
import { getAdmin, getClients, getNetwork, loadDeployment } from '../scripts/lib.mjs'

const PORT = Number(process.env.PORT ?? 8787)
const ROOM_CODE = process.env.ROOM_CODE ?? 'AURA'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'change-moi'
const DRIP = parseEther(process.env.DRIP_MON ?? '0.15') // ≈ 30 tx de tap ; petites doses = peu de MON dormants sur les téléphones
const DRIP_MAX_PER_ADDRESS = Number(process.env.DRIP_MAX_PER_ADDRESS ?? 4) // plafond par joueur = DRIP_MON × ce nombre
let flushMs = Number(process.env.FLUSH_MS ?? 300) // période d'envoi des taps côté téléphone (300 = 1 tx par bloc)
const DRIP_BUDGET = parseEther(process.env.DRIP_BUDGET_MON ?? '30') // plafond de MON distribués par session du serveur
let dripSpent = 0n
const DRIP_BATCH_MS = 400 // les demandes de dotation sont regroupées : une seule tx sert tous les joueurs en attente
const DRIP_BATCH_MAX = 20 // 20 nouveaux comptes ≈ 0,9 M gas : le solde admin doit couvrir limite × maxFee (≈ 0,13 MON) pour que la tx soit incluse

const net = getNetwork()
const admin = getAdmin(net)
const { publicClient } = getClients(net, admin)
const { address: farm, drip: dripContract } = loadDeployment(net)
if (!dripContract) {
  console.error(`Distributeur AuraDrip absent du déploiement : pnpm deploy:${net.name} -- --drip-only`)
  process.exit(1)
}
const adminPump = await new TxPump({ account: admin, chainId: net.chain.id, rpcUrls: net.http }).init()
const call = (functionName, args = []) => encodeFunctionData({ abi: ABI, functionName, args })

// ───────────────────────────────── État en mémoire ─────────────────────────────────
let game = { round: 0, startBlock: 0, endBlock: 0, maxPerTx: 0 }
let head = { number: 0, state: 'Proposed' }
let finalSent = 0 // dernier round dont le résultat officiel a été diffusé
const commit = { voted: 0, finalized: 0 } // plus haut bloc connu dans chaque état
const setCommit = (state, n) => {
  if (n <= commit[state]) return
  commit[state] = n
  queue({ t: 'st', s: state, n })
}
let lastFinal = null // renvoyé aux clients qui (re)chargent la page après la fin du round
const players = new Map() // adresse (minuscules) → { a, name, total, spent, rate, power, round, b }
const perBlock = new Map() // blockId → { n, txs, taps } pour le compteur de débit
const drips = new Map() // adresse → nombre de dotations

const toPlayer = (a, p, b) => ({
  a,
  name: nameOf(a),
  total: Number(p.total),
  spent: Number(p.spent),
  rate: Number(p.rate),
  power: Number(p.power),
  round: Number(p.round),
  b: Number(b), // bloc du dernier règlement → le client projette total + rate × (bloc courant − b)
})

async function loadSnapshot(blockTag = 'latest') {
  const out = []
  for (let offset = 0n; ; offset += 200n) {
    const [g, , addrs, list] = await publicClient.readContract({
      address: farm, abi: ABI, functionName: 'snapshot', args: [offset, 200n], blockTag,
    })
    game = { round: Number(g.round), startBlock: Number(g.startBlock), endBlock: Number(g.endBlock), maxPerTx: Number(g.maxPerTx) }
    addrs.forEach((a, i) => out.push(toPlayer(a.toLowerCase(), list[i], list[i].lastBlock)))
    if (addrs.length < 200) break
  }
  return out
}

for (const p of await loadSnapshot()) players.set(p.a, p)
console.log(`[boot] ${net.chain.name} — contrat ${farm} — round ${game.round} — ${players.size} joueurs`)
// Les MON des joueurs sont dans le contrat AuraDrip, pas sur le wallet admin : sous 10 MON ("reserve balance"),
// un compte Monad ne peut envoyer de la valeur qu'une fois tous les 3 blocs — l'admin ne paie donc que du gas.
// File des dotations : { address, fresh, resolve, reject }. Vidée toutes les DRIP_BATCH_MS en UNE transaction.
const dripQueue = []
// Le solde du distributeur est relu régulièrement : on peut le recharger en cours de partie (faucet → adresse du
// contrat, ou `pnpm drip -- fund`) sans redémarrer le serveur.
let dripBalance = await publicClient.getBalance({ address: dripContract })
setInterval(() => publicClient.getBalance({ address: dripContract }).then((b) => (dripBalance = b)).catch(() => {}), 5000)
const dripLeft = () => {
  const cap = DRIP_BUDGET - dripSpent
  const onchain = dripBalance - BigInt(dripQueue.length) * DRIP
  return cap < onchain ? cap : onchain
}
console.log(`[boot] admin ${admin.address} : ${formatEther(await adminPump.balance())} MON (gas) — distributeur ${formatEther(dripBalance)} MON — code salle "${ROOM_CODE}"`)
if (dripBalance < DRIP) console.warn('[boot] ⚠ distributeur vide : aucun joueur ne pourra être alimenté (pnpm drip -- fund <MON>)')

setInterval(async () => {
  if (!dripQueue.length) return
  const batch = dripQueue.splice(0, DRIP_BATCH_MAX)
  try {
    const fresh = batch.filter((b) => b.fresh).length
    const hash = await adminPump.send({
      to: dripContract,
      data: encodeFunctionData({ abi: DRIP_ABI, functionName: 'drip', args: [batch.map((b) => b.address), DRIP] }),
      gas: dripGas(fresh, batch.length - fresh),
    })
    dripBalance -= DRIP * BigInt(batch.length) // optimiste ; la relecture périodique fait foi
    console.log(`[drip] ${formatEther(DRIP)} MON × ${batch.length} (${batch.map((b) => nameOf(b.address)).join(', ')}) — reste ${formatEther(dripLeft())} MON à distribuer`)
    for (const b of batch) b.resolve(hash)
  } catch (e) {
    for (const b of batch) {
      drips.set(b.address, (drips.get(b.address) ?? 1) - 1) // dotation non envoyée : on la recrédite
      dripSpent -= DRIP
      b.reject(e)
    }
  }
}, DRIP_BATCH_MS)

// ───────────────────────────────── Diffusion WebSocket ─────────────────────────────────
const server = http.createServer(handleHttp)
const wss = new WebSocketServer({ server })
let outbox = []
const queue = (msg) => outbox.push(msg)
setInterval(() => {
  // Un seul message groupé toutes les 100 ms : ~10 msg/s par client quel que soit le débit on-chain.
  if (!outbox.length) return
  const payload = JSON.stringify({ t: 'batch', items: outbox })
  outbox = []
  for (const c of wss.clients) if (c.readyState === 1) c.send(payload)
}, 100)

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ t: 'hello', chainId: net.chain.id, farm, game, head, commit, flushMs, final: lastFinal, players: [...players.values()] }))
})

// ───────────────────────────────── Indexation temps réel ─────────────────────────────────
openFeed({
  wsUrl: net.ws,
  address: farm,
  monad: net.monadSubscriptions,
  onStatus: (s) => console.log(`[feed] ${s}`),
  onEvent: ({ name, args, log, first }) => {
    if (!first) return // les re-publications (Voted, Finalized...) n'apportent rien : valeurs absolues
    if (name === 'RoundStarted' || name === 'RoundStopped') {
      if (name === 'RoundStarted') game = { round: Number(args.round), startBlock: Number(args.startBlock), endBlock: Number(args.endBlock), maxPerTx: Number(args.maxPerTx) }
      else game = { ...game, endBlock: Number(args.endBlock) }
      return queue({ t: 'game', game })
    }
    if (name === 'Joined') {
      const a = args.player.toLowerCase()
      if (!players.has(a)) players.set(a, toPlayer(a, { total: 0, spent: 0, rate: 0, power: 1, round: 0 }, 0))
      return queue({ t: 'p', p: players.get(a) })
    }
    if (name === 'PlayerUpdated') {
      const a = args.player.toLowerCase()
      const next = toPlayer(a, args, log.blockNumber)
      const prev = players.get(a)
      // Garde-fou si un bloc Proposed a été abandonné puis rejoué : on ne recule jamais dans un round.
      if (prev && prev.round === next.round && prev.total > next.total) return
      const gained = prev && prev.round === next.round ? next.total - prev.total : next.total
      players.set(a, next)
      const key = log.blockId ?? log.blockHash
      const blk = perBlock.get(key) ?? { n: Number(log.blockNumber), txs: 0, taps: 0 }
      blk.txs++
      blk.taps += Math.max(0, gained)
      perBlock.set(key, blk)
      queue({ t: 'p', p: next, tx: log.transactionHash })
    }
  },
  onHead: async (h) => {
    if (h.state === 'Proposed' || !net.monadSubscriptions) {
      head = { number: h.number, state: h.state }
      // Le bloc précédent est complet : on publie son débit (tx et taps par bloc de 0,3 s).
      for (const [key, blk] of perBlock) {
        if (blk.n < h.number) {
          queue({ t: 'block', n: blk.n, txs: blk.txs, taps: blk.taps })
          perBlock.delete(key)
        }
      }
      queue({ t: 'head', n: h.number })
    }
    // États de bloc, pour que les clients colorent chaque bloc : proposé → voté → finalisé.
    if (net.monadSubscriptions) {
      if (h.state === 'Voted') setCommit('voted', h.number)
      if (h.state === 'Finalized') setCommit('finalized', h.number)
    } else {
      // anvil n'a pas ces états : on imite le pipeline de MonadBFT (voté à +1 bloc, finalisé à +2)
      // pour que la démo locale ressemble au testnet. Sur le testnet ce sont les vrais états.
      setCommit('voted', h.number - 1)
      setCommit('finalized', h.number - 2)
    }
    // Résultat OFFICIEL : relu dans l'état Finalized (irréversible), ~0,6 s après la fin du round.
    const finalized = h.state === 'Finalized' || h.state === 'Verified' || !net.monadSubscriptions
    if (finalized && game.round > finalSent && game.endBlock > 0 && h.number >= game.endBlock) {
      finalSent = game.round
      try {
        const list = await loadSnapshot(net.monadSubscriptions ? 'finalized' : 'latest')
        for (const p of list) players.set(p.a, p)
        lastFinal = { t: 'final', round: game.round, endBlock: game.endBlock, players: list.filter((p) => p.round === game.round) }
        queue(lastFinal)
        console.log(`[round ${game.round}] résultat finalisé au bloc ${h.number}`)
      } catch (e) {
        finalSent = game.round - 1
        console.error('[final] échec du snapshot :', e.message)
      }
    }
  },
})

// ───────────────────────────────── HTTP ─────────────────────────────────
async function handleHttp(req, res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()
  const send = (code, body) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  try {
    const url = new URL(req.url, 'http://x')
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true, head, game, players: players.size })
    if (req.method !== 'POST') return send(404, { error: 'not found' })
    const body = await readJson(req)

    if (url.pathname === '/drip') {
      const address = String(body.address ?? '').toLowerCase()
      if (String(body.room ?? '').toUpperCase() !== ROOM_CODE.toUpperCase()) return send(403, { error: 'Mauvais code de salle' })
      if (!isAddress(address)) return send(400, { error: 'Adresse invalide' })
      const count = drips.get(address) ?? 0
      if (count >= DRIP_MAX_PER_ADDRESS) return send(429, { error: 'Dotation épuisée pour ce wallet' })
      if (dripLeft() < DRIP) return send(503, { error: 'Réserve de MON épuisée' })
      const balance = await publicClient.getBalance({ address })
      if (balance > DRIP / 3n) return send(200, { ok: true, skipped: true, balance: formatEther(balance) })
      if (dripQueue.some((b) => b.address === address)) return send(200, { ok: true, queued: true })
      drips.set(address, count + 1)
      dripSpent += DRIP
      // Créer un compte coûte 25 000 gas de plus que recharger un compte existant : la limite de gas en dépend.
      const hash = await new Promise((resolve, reject) => dripQueue.push({ address, fresh: balance === 0n, resolve, reject }))
      return send(200, { ok: true, hash, amount: formatEther(DRIP) })
    }

    if (url.pathname === '/admin/check') {
      if (body.token !== ADMIN_TOKEN) return send(403, { error: 'Code régie invalide' })
      return send(200, { ok: true, room: ROOM_CODE })
    }

    if (url.pathname === '/admin/start' || url.pathname === '/admin/stop') {
      if (body.token !== ADMIN_TOKEN) return send(403, { error: 'Code régie invalide' })
      if (body.flushMs) queue({ t: 'cfg', flushMs: (flushMs = Math.max(100, Number(body.flushMs))) })
      const data = url.pathname === '/admin/stop'
        ? call('stopRound')
        : call('startRound', [Number(body.delay ?? 17), Number(body.duration ?? 100), Number(body.maxPerTx ?? 20)])
      const hash = await adminPump.send({ to: farm, data, gas: GAS.startRound })
      return send(200, { ok: true, hash })
    }
    return send(404, { error: 'not found' })
  } catch (e) {
    console.error('[http]', e.message)
    return send(500, { error: e.message })
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 10_000) reject(new Error('corps trop gros'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('JSON invalide'))
      }
    })
  })
}

server.listen(PORT, () => console.log(`[boot] http + ws sur :${PORT}`))
