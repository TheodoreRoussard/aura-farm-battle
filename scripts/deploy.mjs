// Déploie AuraFarm (le jeu) et AuraDrip (le distributeur de MON) depuis les artefacts Foundry.
//   pnpm deploy:local | pnpm deploy:testnet
//   pnpm deploy:testnet -- --drip-only     garde le AuraFarm déjà déployé, (re)déploie seulement AuraDrip
//   ... -- --drip-fund 3.5                 MON versés dans le distributeur (défaut : DRIP_BUDGET_MON, plafonné au solde)
import { formatEther, parseEther } from 'viem'
import { BLOCK_MS } from '../shared/config.mjs'
import { arg, getAdmin, getClients, getNetwork, loadArtifact, loadDeployment, saveDeployment, sleep } from './lib.mjs'

const net = getNetwork()
const admin = getAdmin(net)
const { publicClient, walletClient } = getClients(net, admin)
const DRIP_ONLY = process.argv.includes('--drip-only')
const GAS_KEPT = parseEther(net.name === 'local' ? '100' : '0.6') // l'admin garde de quoi payer le gas (rounds, dotations)

const balance = await publicClient.getBalance({ address: admin.address })
console.log(`Réseau : ${net.chain.name} (${net.chain.id}) — admin ${admin.address} — ${formatEther(balance)} MON`)

// Le déploiement est le seul moment où on laisse viem estimer le gas (une fois, hors du jeu).
async function deploy(name, value = 0n) {
  const { abi, bytecode } = loadArtifact(name)
  const hash = await walletClient.deployContract({ abi, bytecode, value })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Déploiement de ${name} échoué : ${hash}`)
  console.log(`${name} déployé : ${receipt.contractAddress} (bloc ${receipt.blockNumber}, gas ${receipt.gasUsed})`)
  return { address: receipt.contractAddress, block: Number(receipt.blockNumber), hash }
}

let deployment
if (DRIP_ONLY) deployment = loadDeployment(net)
else {
  const farm = await deploy('AuraFarm')
  deployment = { address: farm.address, deployBlock: farm.block, host: admin.address, txHash: farm.hash }
  saveDeployment(net, deployment)
}

// Le distributeur reçoit ses MON dès le constructeur. Sous 10 MON, l'admin ne peut envoyer de la valeur
// que s'il n'a émis aucune tx dans les 3 blocs précédents ("emptying transaction") : on attend 5 blocs.
await sleep(BLOCK_MS * 5)
const left = await publicClient.getBalance({ address: admin.address })
const wanted = parseEther(String(arg('drip-fund', net.name === 'local' ? 1000 : (process.env.DRIP_BUDGET_MON ?? 30))))
const fund = wanted < left - GAS_KEPT ? wanted : left - GAS_KEPT
if (fund <= 0n) throw new Error(`Solde admin trop bas (${formatEther(left)} MON) pour alimenter le distributeur`)
const drip = await deploy('AuraDrip', fund)
saveDeployment(net, { ...deployment, drip: drip.address, dripTxHash: drip.hash })
console.log(`Distributeur alimenté : ${formatEther(fund)} MON — il reste ${formatEther(await publicClient.getBalance({ address: admin.address }))} MON à l'admin pour le gas`)

if (net.name === 'testnet') {
  const verify = (address, name) =>
    `  cd contracts && forge verify-contract ${address} src/${name}.sol:${name} --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/`
  console.log('\nVérification du code source (sans clé API) :')
  if (!DRIP_ONLY) console.log(verify(deployment.address, 'AuraFarm'))
  console.log(verify(drip.address, 'AuraDrip'))
  console.log(`  ${net.explorer}/address/${deployment.address}`)
}
