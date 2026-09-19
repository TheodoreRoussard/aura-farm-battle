// Régie en ligne de commande (secours si l'écran géant ou le serveur sont indisponibles).
//   pnpm round -- start [--delay 17] [--duration 100] [--max 20] [--local]
//   pnpm round -- stop | status
import { encodeFunctionData } from 'viem'
import { ABI, BLOCK_MS } from '../shared/config.mjs'
import { arg, getAdmin, getClients, getNetwork, loadDeployment } from './lib.mjs'

const net = getNetwork()
const admin = getAdmin(net)
const { publicClient, walletClient } = getClients(net, admin)
const farm = loadDeployment(net).address
const cmd = process.argv.find((a) => ['start', 'stop', 'status'].includes(a)) ?? 'status'

const run = async (functionName, args = []) => {
  const hash = await walletClient.sendTransaction({
    to: farm,
    data: encodeFunctionData({ abi: ABI, functionName, args }),
    gas: 60_000n, // limite en dur : pas d'eth_estimateGas
  })
  const r = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`${functionName} → ${r.status} (bloc ${r.blockNumber})`)
}

if (cmd === 'start') await run('startRound', [Number(arg('delay', 17)), Number(arg('duration', 100)), Number(arg('max', 20))])
if (cmd === 'stop') await run('stopRound')

const [round, startBlock, endBlock, maxPerTx] = await publicClient.readContract({ address: farm, abi: ABI, functionName: 'game' })
const now = await publicClient.getBlockNumber()
const left = Number(BigInt(endBlock) - now)
console.log(`round ${round} — blocs ${startBlock} → ${endBlock} — ${maxPerTx} taps max/tx — bloc courant ${now}`)
console.log(left > 0 ? `en cours : encore ${left} blocs (~${((left * BLOCK_MS) / 1000).toFixed(0)} s)` : 'terminé')
