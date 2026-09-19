// Serveur unique d'Aura Farm Battle. Il n'est PAS sur le chemin des taps (les téléphones
// envoient leurs transactions directement au RPC) : s'il tombe, le jeu continue. Il fait 3 choses :
//   1. distributeur de MON (la clé admin ne quitte jamais ce processus — jamais de VITE_*) ;
//   2. indexeur en mémoire : une seule souscription monadLogs, rediffusée aux clients par WebSocket ;
//   3. régie : lancer / arrêter un round depuis l'écran géant.
// À héberger sur une machine qui reste allumée (laptop + cloudflared, Railway...) : pas en serverless.
import http from 'node:http'
import { encodeFunctionData, formatEther, isAddress, parseEther, verifyMessage } from 'viem'
import { WebSocketServer } from 'ws'
import { ABI, GAS } from '../shared/config.mjs'
import { openFeed } from '../shared/feed.mjs'
import { cleanName, nameMessage, nameOf } from '../shared/names.mjs'
import { TxPump } from '../shared/pump.mjs'
import { getAdmin, getClients, getNetwork, loadDeployment } from '../scripts/lib.mjs'

const PORT = Number(process.env.PORT ?? 8787)
const ROOM_CODE = process.env.ROOM_CODE ?? 'AURA'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'change-moi'
const DRIP = parseEther(process.env.DRIP_MON ?? '0.15') // ≈ 30 tx de tap ; petites doses = peu de MON dormants sur les téléphones
const DRIP_MAX_PER_ADDRESS = Number(process.env.DRIP_MAX_PER_ADDRESS ?? 4) // plafond par joueur = DRIP_MON × ce nombre
let flushMs = Number(process.env.FLUSH_MS ?? 300) // période d'envoi des taps côté téléphone (300 = 1 tx par bloc)
let dripBudget = parseEther(process.env.DRIP_BUDGET_MON ?? '30') // plafond global : protège la réserve

const net = getNetwork()
const admin = getAdmin(net)
const { publicClient } = getClients(net, admin)
const farm = loadDeployment(net).address
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
const names = new Map() // adresse → pseudo choisi (le téléphone le renvoie à chaque démarrage)

// `p` = struct Player (snapshot) ou arguments de l'event PlayerUpdated (niveaux packés dans `extra`).
const toPlayer = (a, p, b) => {
  const extra = Number(p.extra ?? 0)
  return {
    a,
    name: names.get(a) ?? nameOf(a),
    total: Number(p.total),
    spent: Number(p.spent),
    rate: Number(p.rate),
    power: Number(p.power),
    mult: p.extra === undefined ? Number(p.mult ?? 0) : extra & 0xff,
    magnet: p.extra === undefined ? Number(p.magnet ?? 0) : (extra >> 8) & 0xff,
    boostUntil: Number(p.boostUntil ?? 0),
    round: Number(p.round),
    b: Number(b), // bloc du dernier règlement → le client projette total + passif × (bloc courant − b)
  }
}

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
console.log(`[boot] admin ${admin.address} : ${formatEther(await adminPump.balance())} MON — code salle "${ROOM_CODE}"`)

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
      if (dripBudget < DRIP) return send(503, { error: 'Réserve de MON épuisée' })
      // Réservé AVANT tout await : sinon plusieurs requêtes simultanées du même téléphone passent
      // toutes le contrôle du plafond (vu en local : 15 dotations au lieu de 4).
      drips.set(address, count + 1)
      dripBudget -= DRIP
      const balance = await publicClient.getBalance({ address })
      if (balance > DRIP / 3n) {
        drips.set(address, drips.get(address) - 1)
        dripBudget += DRIP
        return send(200, { ok: true, skipped: true, balance: formatEther(balance) })
      }
      const hash = await adminPump.send({ to: address, value: DRIP, gas: GAS.transfer })
      console.log(`[drip] ${formatEther(DRIP)} MON → ${address} (${nameOf(address)}) — reste ${formatEther(dripBudget)} MON de budget`)
      return send(200, { ok: true, hash, amount: formatEther(DRIP) })
    }

    if (url.pathname === '/name') {
      const address = String(body.address ?? '').toLowerCase()
      const name = cleanName(body.name)
      if (!isAddress(address) || !name) return send(400, { error: 'Pseudo invalide' })
      const ok = await verifyMessage({ address, message: nameMessage(name), signature: body.signature }).catch(() => false)
      if (!ok) return send(403, { error: 'Signature invalide' })
      names.set(address, name)
      const p = players.get(address)
      if (p) queue({ t: 'p', p: Object.assign(p, { name }) })
      return send(200, { ok: true, name })
    }

    if (url.pathname === '/admin/start' || url.pathname === '/admin/stop') {
      if (body.token !== ADMIN_TOKEN) return send(403, { error: 'Token admin invalide' })
      if (body.flushMs) queue({ t: 'cfg', flushMs: (flushMs = Math.max(100, Number(body.flushMs))) })
      const data = url.pathname === '/admin/stop'
        ? call('stopRound')
        : call('startRound', [Number(body.delay ?? 17), Number(body.duration ?? 100), Number(body.maxPerTx ?? 20)])
      const hash = await adminPump.send({ to: farm, data, gas: 60_000n })
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
