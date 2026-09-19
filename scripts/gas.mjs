// Mesure le gas RÉEL de chaque action avec de vraies transactions (1 tx = accès "à froid"),
// sur `anvil --network monad` (barème Monad / MIP-8). Les tests forge, eux, enchaînent les
// appels dans une seule tx : le stockage y est déjà "chaud", donc leurs chiffres sont trop bas.
// Usage : pnpm anvil   (dans un autre terminal)   puis   node scripts/gas.mjs --local
import { encodeFunctionData, parseEther } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ABI } from '../shared/config.mjs'
import { getAdmin, getClients, getNetwork, loadArtifact, sleep } from './lib.mjs'

const net = getNetwork()
if (net.name !== 'local') {
  console.error('gas.mjs ne tourne que sur le réseau local : ajoute --local.')
  process.exit(1)
}
const admin = getAdmin(net)
const { publicClient, walletClient } = getClients(net, admin)
const { abi, bytecode } = loadArtifact()

const send = async (wallet, params) => {
  const hash = await wallet.sendTransaction({ gas: 500_000n, ...params })
  const r = await publicClient.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`revert : ${JSON.stringify(params)}`)
  return r
}
const call = (functionName, args = []) => encodeFunctionData({ abi: ABI, functionName, args })

const deployHash = await walletClient.deployContract({ abi, bytecode })
const farm = (await publicClient.waitForTransactionReceipt({ hash: deployHash })).contractAddress

const burner = privateKeyToAccount(generatePrivateKey())
const { walletClient: player } = getClients(net, burner)
await send(walletClient, { to: burner.address, value: parseEther('1') })

const rows = []
const measure = async (label, wallet, data) => {
  const r = await send(wallet, { to: farm, data })
  rows.push({ action: label, gas: Number(r.gasUsed) })
}

await measure('join()', player, call('join'))
await measure('startRound()', walletClient, call('startRound', [2, 100000, 20]))
await sleep(1500) // laisse passer le délai de départ
await measure('tap(1)  — 1er tap du round', player, call('tap', [1]))
await measure('tap(1)  — suivant', player, call('tap', [1]))
await measure('tap(20) — suivant', player, call('tap', [20]))
await measure('tap(20) — suivant', player, call('tap', [20]))
await measure('tap(20) — suivant', player, call('tap', [20]))
await measure('buy(POWER)', player, call('buy', [0]))
await measure('buy(RATE)', player, call('buy', [1]))
await measure('tap(5)  — avec revenu passif', player, call('tap', [5]))
for (let i = 0; i < 30; i++) await send(player, { to: farm, data: call('tap', [20]) }) // de l'aura pour les améliorations suivantes
await measure('buy(MEGA)', player, call('buy', [2]))
await measure('buy(FARM)', player, call('buy', [3]))
await measure('buy(COMBO)', player, call('buy', [4]))
await measure('buy(MAGNET)', player, call('buy', [5]))
await measure('bonus — claimBonus()', player, call('claimBonus'))
await measure('tap(20) — bonus actif + améliorations', player, call('tap', [20]))
await measure('stopRound()', walletClient, call('stopRound'))
await measure('startRound() — round 2', walletClient, call('startRound', [2, 100000, 1]))
await sleep(1500)
await measure('tap(1)  — 1er tap du round 2', player, call('tap', [1]))
await measure('tap(1)  — suivant (mode 1 tap = 1 tx)', player, call('tap', [1]))

console.table(rows)
const max = (re) => Math.max(...rows.filter((r) => re.test(r.action)).map((r) => r.gas))
const margin = (g) => Math.ceil((g * 1.03) / 100) * 100
console.log('\nÀ reporter dans shared/config.mjs (max mesuré + 3 %) :')
console.log(`  join: ${margin(max(/^join/))}n, tap: ${margin(max(/^tap/))}n, buy: ${margin(max(/^buy/))}n, bonus: ${margin(max(/^bonus/))}n`)
console.log(`\nCoût d'un tap à 100 gwei : ${(margin(max(/^tap/)) * 100e-9).toFixed(5)} MON`)
