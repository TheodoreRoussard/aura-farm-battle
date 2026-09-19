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
  tap: 51_800n, // mesuré 50 182 — identique pour tap(1) et tap(20), 1er tap du round inclus
  buy: 51_800n, // mesuré 50 258 max (toutes améliorations)
  bonus: 50_900n, // claimBonus() mesuré 49 360
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
  'struct Player { uint48 total; uint48 spent; uint32 lastBlock; uint32 boostUntil; uint16 round; uint16 rate; uint16 power; uint8 mult; uint24 multBps; uint8 magnet; uint8 frac; }',
  'function host() view returns (address)',
  'function game() view returns (uint32 round, uint40 startBlock, uint40 endBlock, uint8 maxPerTx)',
  'function players(address) view returns (Player)',
  'function totalOf(address who) view returns (uint64)',
  'function rosterLength() view returns (uint256)',
  'function snapshot(uint256 offset, uint256 limit) view returns (Game g, uint256 blockNumber, address[] addrs, Player[] list)',
  'function powerCost(uint24 power) pure returns (uint64)',
  'function rateCost(uint24 rate) pure returns (uint64)',
  'function multCost(uint24 level) pure returns (uint64)',
  'function magnetCost(uint24 level) pure returns (uint64)',
  'function claimBonus()',
  'function startRound(uint32 delayBlocks, uint32 durationBlocks, uint8 maxPerTx)',
  'function stopRound()',
  'function join()',
  'function tap(uint8 count)',
  'function buy(uint8 kind)',
  'event RoundStarted(uint32 indexed round, uint40 startBlock, uint40 endBlock, uint8 maxPerTx)',
  'event RoundStopped(uint32 indexed round, uint40 endBlock)',
  'event Joined(address indexed player)',
  'event PlayerUpdated(address indexed player, uint32 round, uint64 total, uint64 spent, uint24 rate, uint24 power, uint64 extra, uint40 boostUntil)',
  'error NotHost()',
  'error NotJoined()',
  'error RoundNotLive()',
  'error BadCount()',
  'error BadKind()',
  'error TooPoor()',
  'error MaxLevel()',
  'error BonusCooldown()',
])

export const KIND_POWER = 0
export const KIND_RATE = 1
export const KIND_MULT = 2
export const KIND_MAGNET = 3

// Miroir des formules du contrat (le front affiche les prix sans appel RPC).
export const powerCost = (power) => 20n * BigInt(power) * BigInt(power)
export const rateCost = (rate) => 30n * (BigInt(rate) + 1n) * (BigInt(rate) + 1n)
const quad = (k) => (level) => k * (BigInt(level) + 1n) * (BigInt(level) + 1n)
/** Multiplicateur de taps en 1/10 000 après `level` achats (miroir exact de buy() : x1,01 arrondi à chaque niveau). */
export const multBpsOf = (level) => {
  let bps = 10_000
  for (let i = 0; i < level; i++) bps = Math.floor((bps * 101) / 100)
  return bps
}

// Bonus "x5" (miroir de BOOST_* dans AuraFarm.sol)
export const BOOST_MULT = 5
export const BOOST_BLOCKS = 17 // ~5 s
export const BOOST_PER_MAGNET = 7 // ~2 s par niveau d'aimant
export const BONUS_GAP = 40 // ~12 s de repos entre deux bonus
export const boostBlocks = (magnet) => BOOST_BLOCKS + BOOST_PER_MAGNET * magnet

/** Catalogue des améliorations : `key` = champ du joueur (niveau), `kind` = argument de buy(). */
export const UPGRADES = [
  { kind: KIND_POWER, key: 'power', icon: '☕', label: 'Cappuccino Assassino', base: 1, max: 1000, cost: powerCost, detail: (n) => `+1 aura par tap · niv. ${n}` },
  { kind: KIND_MULT, key: 'mult', icon: '📈', label: 'Espresso Sigma', base: 0, max: 250, cost: (n) => 10n * (BigInt(n) + 1n), detail: (n) => `taps x1,01 · actuel x${(multBpsOf(n) / 10_000).toFixed(2).replace('.', ',')}` },
  { kind: KIND_RATE, key: 'rate', icon: '🌿', label: 'Brr Brr Patapim', base: 0, max: 1000, cost: rateCost, detail: (n) => `+1 aura par bloc · niv. ${n}` },
  { kind: KIND_MAGNET, key: 'magnet', icon: '🧲', label: 'Aimant à Bonus', base: 0, max: 10, cost: quad(200n), detail: (n) => `bonus +2 s · niv. ${n}` },
]

/** Niveaux d'un joueur (valeurs de départ si absent ou d'un round précédent). */
export const levelsOf = (p, round) => ({
  power: 1, rate: 0, mult: 0, magnet: 0, boostUntil: 0,
  ...(p && p.round === round ? p : {}),
})
/** Aura passive par bloc (miroir de _settle). */
export const passivePerBlock = (p) => p.rate
/** Aura d'un tap (miroir de tap() ; fractionnaire pour l'affichage). */
export const tapValue = (p, boosted) => (p.power * multBpsOf(p.mult) * (boosted ? BOOST_MULT : 1)) / 10_000

// Paliers d'évolution : fonction pure du total → le front déclenche l'animation sans attendre la chaîne.
// `slug` = nom du dessin dans web/src/Brainrot.jsx et du PNG optionnel web/public/sprites/<slug>.png.
// Seuils calibrés pour un round de 30 s (~150 taps sans amélioration) : tout le monde voit 2-3
// évolutions, seuls les acharnés (avec améliorations) atteignent Tralalero Tralala.
export const STAGES = [
  { min: 0n, slug: 'chimpanzini-bananini', name: 'Chimpanzini Bananini' },
  { min: 30n, slug: 'ballerina-cappuccina', name: 'Ballerina Cappuccina' },
  { min: 100n, slug: 'lirili-larila', name: 'Lirili Larilà' },
  { min: 250n, slug: 'tung-tung-tung-sahur', name: 'Tung Tung Tung Sahur' },
  { min: 600n, slug: 'bombardiro-crocodilo', name: 'Bombardiro Crocodilo' },
  { min: 1500n, slug: 'tralalero-tralala', name: 'Tralalero Tralala' },
]
export const stageOf = (total) => {
  let s = 0
  for (let i = 0; i < STAGES.length; i++) if (BigInt(total) >= STAGES[i].min) s = i
  return s
}
