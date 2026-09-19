// Logique du jeu côté navigateur, sans React (deux petits "stores" observables).
//   createLive()   : connexion au serveur → round, bloc courant, classement, débit par bloc.
//   createPlayer() : wallet jetable + envoi des taps.
import { createPublicClient, encodeFunctionData, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ABI, GAS, NETWORKS } from '../../shared/config.mjs'
import { nameOf } from '../../shared/names.mjs'
import { TxPump } from '../../shared/pump.mjs'

const NETWORK = import.meta.env.VITE_NETWORK ?? 'testnet'
const lanHost = (url) => url.replace('127.0.0.1', location.hostname) // dev : téléphone sur le même réseau que le laptop
export const NET = { ...NETWORKS[NETWORK], http: NETWORKS[NETWORK].http.map(lanHost) }
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? `http://${location.hostname}:8787`

const SEND_MARGIN_BLOCKS = 3 // on cesse d'envoyer 3 blocs avant la fin : un tap en retard revert ET paie toute sa gas limit
const UNCONFIRMED_TTL = 6000

function createStore(state) {
  const listeners = new Set()
  let scheduled = false
  const store = {
    state,
    version: 0,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    notify() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        store.version++
        listeners.forEach((fn) => fn())
      })
    },
  }
  return store
}

// ───────────────────────────────────── Live ─────────────────────────────────────

export function createLive() {
  const store = createStore({
    connected: false,
    farm: null,
    flushMs: 300,
    game: { round: 0, startBlock: 0, endBlock: 0, maxPerTx: 0 },
    head: 0,
    voted: 0, // plus haut bloc voté (finalité spéculative, +1 bloc)
    finalized: 0, // plus haut bloc finalisé (irréversible, +2 blocs)
    players: new Map(),
    blocks: [], // { n, txs, taps } des ~60 derniers blocs actifs
    roundStats: { round: 0, txs: 0, taps: 0, peakTxs: 0 },
    final: null,
  })
  const s = store.state
  const handlers = new Set() // abonnés aux mises à jour brutes (le joueur y cherche ses confirmations)
  let retry = 0

  const apply = (it) => {
    if (it.t === 'head') s.head = it.n
    else if (it.t === 'st') s[it.s] = Math.max(s[it.s], it.n)
    else if (it.t === 'game') {
      if (it.game.round !== s.game.round) s.final = null
      s.game = it.game
    } else if (it.t === 'cfg') s.flushMs = it.flushMs
    else if (it.t === 'p') s.players.set(it.p.a, { ...s.players.get(it.p.a), ...it.p })
    else if (it.t === 'block') {
      s.blocks = [...s.blocks.slice(-59), it]
      if (s.roundStats.round !== s.game.round) s.roundStats = { round: s.game.round, txs: 0, taps: 0, peakTxs: 0 }
      s.roundStats.txs += it.txs
      s.roundStats.taps += it.taps
      s.roundStats.peakTxs = Math.max(s.roundStats.peakTxs, it.txs)
    } else if (it.t === 'final') {
      s.final = it
      for (const p of it.players) s.players.set(p.a, { ...s.players.get(p.a), ...p })
    }
    handlers.forEach((h) => h(it))
  }

  const connect = () => {
    const ws = new WebSocket(SERVER_URL.replace(/^http/, 'ws'))
    ws.onopen = () => (retry = 0)
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.t === 'hello') {
        Object.assign(s, { connected: true, farm: m.farm, game: m.game, head: m.head.number, flushMs: m.flushMs ?? 300, final: m.final ?? null, voted: m.commit?.voted ?? 0, finalized: m.commit?.finalized ?? 0 })
        s.players = new Map(m.players.map((p) => [p.a, p]))
      } else m.items.forEach(apply)
      store.notify()
    }
    ws.onclose = () => {
      s.connected = false
      store.notify()
      setTimeout(connect, Math.min(4000, 300 * 2 ** retry++))
    }
    ws.onerror = () => ws.close()
  }
  connect()

  // Vitesse de spam : aura gagnée sur la dernière seconde, par joueur.
  setInterval(() => {
    for (const p of s.players.values()) {
      const now = projected(p, s)
      p.speed = p._last === undefined ? 0 : Math.max(0, now - p._last)
      p._last = now
    }
    store.notify()
  }, 1000)

  store.onItem = (fn) => (handlers.add(fn), () => handlers.delete(fn))
  return store
}

/** Total affiché d'un joueur : dernier total on-chain + revenu passif écoulé depuis (même formule que totalOf()). */
export function projected(p, live) {
  if (!p || p.round !== live.game.round) return 0
  const nowB = Math.min(live.head, live.game.endBlock)
  return p.total + (nowB > p.b ? p.rate * (nowB - p.b) : 0)
}

export function ranking(live) {
  return [...live.players.values()]
    .filter((p) => p.round === live.game.round)
    .map((p) => ({ ...p, score: projected(p, live) }))
    .sort((a, b) => b.score - a.score)
}

/** État d'un bloc vu du client : 'finalized' | 'voted' | 'proposed' | 'future'. */
export const blockState = (live, n) => (n > live.head ? 'future' : n <= live.finalized ? 'finalized' : n <= live.voted ? 'voted' : 'proposed')

export const roundPhase = (live) => {
  const { game, head } = live
  if (!game.round || !head) return 'idle'
  if (head < game.startBlock) return 'countdown'
  if (head < game.endBlock) return 'live'
  return 'over'
}

// ───────────────────────────────────── Joueur ─────────────────────────────────────

export function createPlayer(liveStore) {
  const live = liveStore.state
  let pk = localStorage.getItem('aura.pk')
  if (!pk) localStorage.setItem('aura.pk', (pk = generatePrivateKey()))
  const account = privateKeyToAccount(pk)
  const address = account.address.toLowerCase()
  const publicClient = createPublicClient({ transport: http(NET.http[0]) })
  const call = (functionName, args = []) => encodeFunctionData({ abi: ABI, functionName, args })

  const store = createStore({
    phase: 'boot', // boot → room? → funding → warming → joining → ready | error
    error: null,
    address,
    name: nameOf(address),
    room: new URLSearchParams(location.search).get('room') ?? localStorage.getItem('aura.room') ?? '',
    balance: null, // MON du wallet jetable = "énergie"
    pendingTaps: 0, // taps pas encore envoyés
    unconfirmed: new Map(), // hash → { count, at } : taps envoyés, pas encore vus on-chain
    lastLatency: null,
    myBlocks: new Map(), // n° de bloc → { count: mes taps inclus dans ce bloc, at: quand je l'ai appris } (frise de blocs)
    myTxs: [], // mes dernières tx : { hash, count, sentAt, block, seenMs, finalMs }
    txSent: 0,
    txSeen: 0,
    buying: false,
  })
  const s = store.state
  const pump = new TxPump({
    account,
    chainId: NET.chain.id,
    rpcUrls: NET.http,
    onDropped: (items) => {
      // tx abandonnées par le chien de garde : on remet leurs taps dans la file
      for (const it of items) if (it.meta?.count) s.pendingTaps += it.meta.count
      store.notify()
    },
  })

  const fail = (e) => {
    s.phase = 'error'
    s.error = e.message ?? String(e)
    store.notify()
  }
  const setPhase = (p) => {
    s.phase = p
    store.notify()
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  async function drip() {
    const res = await fetch(`${SERVER_URL}/drip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, room: s.room }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.status === 403) return 'bad-room'
    if (!res.ok) throw new Error(body.error ?? `drip HTTP ${res.status}`)
    return body.skipped ? 'skipped' : 'sent'
  }

  async function boot() {
    try {
      setPhase('boot')
      await pump.init()
      s.balance = await pump.balance()
      const minBalance = GAS.join * pump._maxFee() * 2n
      if (s.balance < minBalance) {
        if (!s.room) return setPhase('room')
        setPhase('funding')
        if ((await drip()) === 'bad-room') return setPhase('room')
        localStorage.setItem('aura.room', s.room)
        while ((s.balance = await pump.balance()) < minBalance) await sleep(400)
        // Règle Monad (reserve balance) : le consensus valide les soldes sur un état en retard de
        // k = 3 blocs → un compte fraîchement alimenté attend ~1,2 s avant sa première transaction.
        setPhase('warming')
        await sleep(1500)
      }
      const onchain = await publicClient.readContract({ address: live.farm ?? (await waitFarm()), abi: ABI, functionName: 'players', args: [address] })
      if (onchain[4] === 0) {
        setPhase('joining')
        await pump.send({ to: live.farm, data: call('join'), gas: GAS.join })
        if (!(await pump.drain(10000))) throw new Error('join() non confirmé')
      }
      setPhase('ready')
    } catch (e) {
      fail(e)
    }
  }
  const waitFarm = async () => {
    while (!live.farm) await sleep(100)
    return live.farm
  }

  // Confirmations : le serveur rediffuse chaque PlayerUpdated avec le hash de la transaction.
  liveStore.onItem((it) => {
    if (it.t === 'st' && it.s === 'finalized') {
      // Mes tx dont le bloc vient d'être finalisé : on note le délai total envoi → irréversible.
      for (const tx of s.myTxs) if (tx.finalMs === null && tx.block <= it.n) tx.finalMs = Date.now() - tx.sentAt
      return
    }
    if (it.t !== 'p' || it.p.a !== address || !it.tx) return
    const ms = pump.seen(it.tx)
    if (ms !== null) s.lastLatency = ms
    const mine = s.unconfirmed.get(it.tx)
    if (!mine) return
    s.unconfirmed.delete(it.tx)
    s.txSeen++
    s.myBlocks.set(it.p.b, { count: (s.myBlocks.get(it.p.b)?.count ?? 0) + mine.count, at: Date.now() })
    if (s.myBlocks.size > 80) s.myBlocks.delete(s.myBlocks.keys().next().value)
    s.myTxs = [...s.myTxs.slice(-19), { hash: it.tx, count: mine.count, sentAt: mine.at, block: it.p.b, seenMs: ms, finalMs: null }]
  })

  const canSend = () => s.phase === 'ready' && live.head >= live.game.startBlock && live.head < live.game.endBlock - SEND_MARGIN_BLOCKS

  function flush() {
    if (!canSend() || s.pendingTaps === 0) return
    const count = Math.min(s.pendingTaps, live.game.maxPerTx)
    s.pendingTaps -= count
    s.txSent++
    pump
      .send({ to: live.farm, data: call('tap', [count]), gas: GAS.tap, meta: { count } })
      .then((hash) => s.unconfirmed.set(hash, { count, at: Date.now() }))
      .catch(() => (s.pendingTaps += count))
  }

  let flushTimer = null
  const armFlush = () => {
    clearInterval(flushTimer)
    flushTimer = setInterval(flush, live.flushMs)
  }
  armFlush()
  liveStore.onItem((it) => it.t === 'cfg' && armFlush())

  // Ménage + énergie
  setInterval(async () => {
    const now = Date.now()
    for (const [h, u] of s.unconfirmed) if (now - u.at > UNCONFIRMED_TTL) s.unconfirmed.delete(h) // tx revert ou perdue
    if (roundPhase(live) === 'over') s.pendingTaps = 0
    if (s.phase !== 'ready') return
    try {
      s.balance = await pump.balance()
      if (s.balance < GAS.tap * pump._maxFee() * 12n) drip().catch(() => {}) // bientôt à sec : on redemande
    } catch {}
    store.notify()
  }, 3000)

  Object.assign(store, {
    boot,
    setRoom(code) {
      s.room = code.trim().toUpperCase()
      boot()
    },
    /** Un tap = +1 immédiatement à l'écran (optimiste), la chaîne suit en arrière-plan. */
    tap() {
      if (!canSend()) return false
      s.pendingTaps++
      if (live.game.maxPerTx === 1) flush() // mode "1 tap = 1 transaction" : envoi immédiat
      store.notify()
      return true
    },
    async buy(kind) {
      if (!canSend() || s.buying) return
      s.buying = true
      flush() // les taps en attente partent AVANT l'achat : même expéditeur → l'ordre des nonces est garanti
      store.notify()
      try {
        await pump.send({ to: live.farm, data: call('buy', [kind]), gas: GAS.buy })
        await pump.drain(5000)
      } finally {
        s.buying = false
        store.notify()
      }
    },
    /** Taps faits mais pas encore confirmés on-chain (en file + en vol). */
    optimisticTaps() {
      let n = s.pendingTaps
      for (const u of s.unconfirmed.values()) n += u.count
      return n
    },
    /** Nombre de transactions de tap encore finançables avec le solde du wallet. */
    txLeft() {
      return s.balance === null ? null : Number(s.balance / (GAS.tap * pump._maxFee()))
    },
    canSend,
  })
  return store
}
