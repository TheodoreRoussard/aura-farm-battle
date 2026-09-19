// Helpers Node communs aux scripts et au serveur.
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { NETWORKS } from '../shared/config.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Clé n°0 d'anvil, publique et connue de tous : uniquement pour le réseau local.
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

export function getNetwork(argv = process.argv) {
  const name = argv.includes('--local') || process.env.NETWORK === 'local' ? 'local' : 'testnet'
  const net = { name, ...NETWORKS[name] }
  // Une clé RPC dédiée (Alchemy / QuickNode gratuit) passe devant les endpoints publics.
  if (name === 'testnet' && process.env.RPC_URL) net.http = [process.env.RPC_URL, ...net.http]
  if (name === 'testnet' && process.env.RPC_WS) net.ws = process.env.RPC_WS
  return net
}

export function getAdmin(net) {
  const key = net.name === 'local' ? ANVIL_KEY : process.env.ADMIN_PRIVATE_KEY
  if (!key) {
    console.error('ADMIN_PRIVATE_KEY manquant dans .env (voir .env.example).')
    process.exit(1)
  }
  return privateKeyToAccount(key)
}

export function getClients(net, account) {
  const transport = http(net.http[0], { batch: false, retryCount: 2 })
  return {
    publicClient: createPublicClient({ chain: net.chain, transport }),
    walletClient: account ? createWalletClient({ chain: net.chain, transport, account }) : null,
  }
}

const deploymentFile = (net) => path.join(ROOT, 'deployments', `${net.chain.id}.json`)

export function saveDeployment(net, data) {
  fs.mkdirSync(path.dirname(deploymentFile(net)), { recursive: true })
  fs.writeFileSync(deploymentFile(net), JSON.stringify(data, null, 2) + '\n')
}

export function loadDeployment(net) {
  const f = deploymentFile(net)
  if (!fs.existsSync(f)) {
    console.error(`Aucun déploiement pour la chaîne ${net.chain.id}. Lance d'abord : pnpm deploy:${net.name}`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'))
}

export function loadArtifact(name = 'AuraFarm') {
  const f = path.join(ROOT, `contracts/out/${name}.sol/${name}.json`)
  if (!fs.existsSync(f)) {
    console.error('Artefact introuvable : lance `cd contracts && forge build`.')
    process.exit(1)
  }
  const { abi, bytecode } = JSON.parse(fs.readFileSync(f, 'utf8'))
  return { abi, bytecode: bytecode.object }
}

export const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
