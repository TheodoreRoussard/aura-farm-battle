// Gestion du distributeur de MON (AuraDrip).
//   pnpm drip                 solde du distributeur et de l'admin
//   pnpm drip -- fund 2       verse 2 MON de l'admin vers le distributeur
//   pnpm drip -- withdraw     rapatrie tout le solde du distributeur vers l'admin (fin de journée)
// Ne pas lancer fund / withdraw pendant que le serveur tourne : les deux utilisent les nonces du wallet admin.
import { encodeFunctionData, formatEther, parseEther } from 'viem'
import { BLOCK_MS, DRIP_ABI } from '../shared/config.mjs'
import { getAdmin, getClients, getNetwork, loadDeployment, sleep } from './lib.mjs'

const net = getNetwork()
const admin = getAdmin(net)
const { publicClient, walletClient } = getClients(net, admin)
const { drip } = loadDeployment(net)
if (!drip) throw new Error(`Pas de distributeur déployé : pnpm deploy:${net.name} -- --drip-only`)
const [action, amount] = process.argv.slice(2).filter((a) => !a.startsWith('--'))

const show = async () => {
  const [d, a] = await Promise.all([publicClient.getBalance({ address: drip }), publicClient.getBalance({ address: admin.address })])
  console.log(`Distributeur ${drip} : ${formatEther(d)} MON — admin ${admin.address} : ${formatEther(a)} MON`)
}
const wait = async (hash) => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Transaction annulée : ${hash}`)
}

await show()
if (action === 'fund') {
  // Transfert de valeur depuis un compte sous 10 MON : autorisé seulement après 3 blocs sans tx de l'admin.
  await sleep(BLOCK_MS * 5)
  await wait(await walletClient.sendTransaction({ to: drip, value: parseEther(amount ?? '1'), gas: 30_000n }))
  await show()
} else if (action === 'withdraw') {
  await wait(await walletClient.sendTransaction({ to: drip, data: encodeFunctionData({ abi: DRIP_ABI, functionName: 'withdraw' }), gas: 60_000n }))
  await show()
}
