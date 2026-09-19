// Déploie AuraFarm depuis l'artefact Foundry. Usage : pnpm deploy:local | pnpm deploy:testnet
import { formatEther } from 'viem'
import { getAdmin, getClients, getNetwork, loadArtifact, saveDeployment } from './lib.mjs'

const net = getNetwork()
const admin = getAdmin(net)
const { publicClient, walletClient } = getClients(net, admin)
const { abi, bytecode } = loadArtifact()

const balance = await publicClient.getBalance({ address: admin.address })
console.log(`Réseau : ${net.chain.name} (${net.chain.id}) — admin ${admin.address} — ${formatEther(balance)} MON`)

// Le déploiement est la seule tx où on laisse viem estimer le gas (une fois, hors du jeu).
const hash = await walletClient.deployContract({ abi, bytecode })
const receipt = await publicClient.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success') throw new Error(`Déploiement échoué : ${hash}`)

saveDeployment(net, {
  address: receipt.contractAddress,
  deployBlock: Number(receipt.blockNumber),
  host: admin.address,
  txHash: hash,
})
console.log(`AuraFarm déployé : ${receipt.contractAddress} (bloc ${receipt.blockNumber}, gas ${receipt.gasUsed})`)
if (net.name === 'testnet') {
  console.log('\nVérification du code source (sans clé API) :')
  console.log(
    `  cd contracts && forge verify-contract ${receipt.contractAddress} src/AuraFarm.sol:AuraFarm --chain 10143 ` +
      '--verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/',
  )
  console.log(`  ${net.explorer}/address/${receipt.contractAddress}`)
}
