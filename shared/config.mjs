// Config partagée par les scripts, le serveur et le front (JS pur, aucun import Node ici).
import { defineChain, parseAbi, parseGwei } from 'viem'
import { monadTestnet } from 'viem/chains'

export const anvilMonad = defineChain({
  id: 31337,
  name: 'Anvil (Monad)',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'], webSocket: ['ws://127.0.0.1:8545'] } },
})

export const NETWORKS = {
  testnet: {
    chain: monadTestnet,
    // Les 3 endpoints publics renvoient les en-têtes CORS (vérifié) : les téléphones
    // envoient leurs transactions en direct, chacun depuis sa propre connexion/IP.
    http: [
      'https://testnet-rpc.monad.xyz', // QuickNode, 50 req/s par IP, batch 100
      'https://rpc.ankr.com/monad_testnet', // Ankr, 300 req / 10 s
      'https://rpc-testnet.monadinfra.com', // Monad Foundation, 20 req/s, pas de batch
    ],
    ws: 'wss://testnet-rpc.monad.xyz',
    monadSubscriptions: true, // monadLogs / monadNewHeads (états Proposed → Finalized)
    explorer: 'https://testnet.monadvision.com',
  },
  local: {
    chain: anvilMonad,
    http: ['http://127.0.0.1:8545'],
    ws: 'ws://127.0.0.1:8545',
    monadSubscriptions: false, // anvil ne connaît que logs / newHeads
    explorer: '',
  },
}

// ─── Gas ────────────────────────────────────────────────────────────────────────
// Sur Monad on paie gas_limit × prix, PAS le gas consommé. Ces limites sont donc
// la vraie facture : mesurées avec `node scripts/gas.mjs`, + ~3 % de marge.
// Ne JAMAIS appeler eth_estimateGas dans le jeu (latence + 25 req/s sur le RPC public).
export const GAS = {
  join: 109_900n, // mesuré 106 652
  tap: 46_600n, // mesuré 45 164 — identique pour tap(1) et tap(20), 1er tap du round inclus
  buy: 47_200n, // mesuré 45 749 max
  transfer: 21_000n,
}

// Prix : base fee plancher = 100 gwei sur Monad (impossible de descendre en dessous).
// Le pourboire (priority fee) est le seul levier côté prix : 0 tant que les blocs sont vides.
export const FEES = {
  maxPriorityFeePerGas: parseGwei('0'),
  // On paie min(base + pourboire, max) : un plafond large ne coûte rien, mais le solde doit
  // couvrir gas_limit × maxFeePerGas pour que la tx soit acceptée → on reste à 1,5 × la base.
  maxFeeMultiplier: 1.5,
}

export const BLOCK_MS = 300 // testnet mesuré : ~300 ms

export const ABI = parseAbi([
  'struct Game { uint32 round; uint40 startBlock; uint40 endBlock; uint8 maxPerTx; }',
  'struct Player { uint64 total; uint64 spent; uint40 lastBlock; uint24 rate; uint24 power; uint32 round; }',
  'function host() view returns (address)',
  'function game() view returns (uint32 round, uint40 startBlock, uint40 endBlock, uint8 maxPerTx)',
  'function players(address) view returns (uint64 total, uint64 spent, uint40 lastBlock, uint24 rate, uint24 power, uint32 round)',
  'function totalOf(address who) view returns (uint64)',
  'function rosterLength() view returns (uint256)',
  'function snapshot(uint256 offset, uint256 limit) view returns (Game g, uint256 blockNumber, address[] addrs, Player[] list)',
  'function powerCost(uint24 power) pure returns (uint64)',
  'function rateCost(uint24 rate) pure returns (uint64)',
  'function startRound(uint32 delayBlocks, uint32 durationBlocks, uint8 maxPerTx)',
  'function stopRound()',
  'function join()',
  'function tap(uint8 count)',
  'function buy(uint8 kind)',
  'event RoundStarted(uint32 indexed round, uint40 startBlock, uint40 endBlock, uint8 maxPerTx)',
  'event RoundStopped(uint32 indexed round, uint40 endBlock)',
  'event Joined(address indexed player)',
  'event PlayerUpdated(address indexed player, uint32 round, uint64 total, uint64 spent, uint24 rate, uint24 power)',
  'error NotHost()',
  'error NotJoined()',
  'error RoundNotLive()',
  'error BadCount()',
  'error BadKind()',
  'error TooPoor()',
])

export const KIND_POWER = 0
export const KIND_RATE = 1

// Miroir des formules du contrat (le front affiche les prix sans appel RPC).
export const powerCost = (power) => 20n * BigInt(power) * BigInt(power)
export const rateCost = (rate) => 30n * (BigInt(rate) + 1n) * (BigInt(rate) + 1n)

// Paliers d'évolution : fonction pure du total → le front déclenche l'animation sans attendre la chaîne.
export const STAGES = [
  { min: 0n, name: 'Bambino Skibidi' },
  { min: 100n, name: 'Tullio Vespa Rizzler' },
  { min: 400n, name: 'Giga-Chad Nonna' },
  { min: 1500n, name: 'Entité Cosmique Carbonara' },
]
export const stageOf = (total) => {
  let s = 0
  for (let i = 0; i < STAGES.length; i++) if (BigInt(total) >= STAGES[i].min) s = i
  return s
}
