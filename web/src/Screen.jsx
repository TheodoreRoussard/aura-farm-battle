// Écran géant projeté pendant le pitch : c'est LUI la démo.
//   /screen                          → classement ; le formulaire "Régie" demande le code régie (ADMIN_TOKEN du .env)
//   /screen?room=AURA&token=SECRET   → lien direct affiché par `pnpm prod` : régie déverrouillée d'emblée
// Le code régie est rangé dans le localStorage puis RETIRÉ de la barre d'adresse : cet écran est projeté en public.
import QRCode from 'qrcode'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { BLOCK_MS, GAS, stageOf } from '../../shared/config.mjs'
import Brainrot from './Brainrot.jsx'
import { SERVER_URL, blockState, createLive, ranking, roundPhase } from './game.js'
import { useStore } from './hooks.js'

const liveStore = createLive()
const params = new URLSearchParams(location.search)
const stored = (key) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // navigation privée, stockage bloqué : on s'en passe
  }
}
const store = (key, value) => {
  try {
    value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)
  } catch {}
}
// Musique de fond : UNIQUEMENT sur l'écran géant (la page joueur ne connaît pas ce fichier, sinon chaque
// téléphone jouerait la musique). Web Audio plutôt que <audio loop> : la boucle repart sans blanc.
// Les navigateurs n'autorisent le son qu'après un geste (clic, touche) : prime() doit être appelé PENDANT ce geste.
const MUSIC_URL = encodeURI('/audio/Short Clicker Loop.mp3')
const MUSIC_VOLUME = 0.7
const music = (() => {
  let ctx = null
  let gain = null
  let loading = null
  let source = null
  let muted = stored('aura.music') === 'off'
  const listeners = new Set()
  const notify = () => listeners.forEach((fn) => fn())
  const ensure = () => {
    if (!ctx) {
      ctx = new AudioContext()
      gain = ctx.createGain()
      gain.gain.value = MUSIC_VOLUME
      gain.connect(ctx.destination)
      ctx.onstatechange = notify
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  }
  const load = () => (loading ??= fetch(MUSIC_URL).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)))
  const api = {
    prime() {
      ensure()
      load().catch(() => {})
    },
    async play() {
      if (muted || source) return
      ensure()
      const buffer = await load().catch(() => null)
      if (!buffer || muted || source) return
      source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.connect(gain)
      source.start()
      notify()
    },
    stop() {
      source?.stop()
      source = null
      notify()
    },
    toggle() {
      muted = !muted
      store('aura.music', muted ? 'off' : null)
      if (muted) api.stop()
      else api.prime(), api.play()
      notify()
    },
    /** 'on' | 'off' (coupée) | 'blocked' (le navigateur attend un clic) */
    status: () => (muted ? 'off' : source && ctx?.state === 'running' ? 'on' : 'blocked'),
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  }
  return api
})()

if (params.get('token')) {
  store('aura.token', params.get('token'))
  params.delete('token')
  const rest = params.toString()
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}`)
}
const INITIAL_ROOM = (params.get('room') ?? stored('aura.room') ?? '').toUpperCase()
const BLOCK_GAS_LIMIT = 150_000_000 // capacité d'un bloc Monad
const MON_PER_TX = Number(GAS.tap) * 100e-9 // gas limit × base fee plancher (100 gwei)
const RIBBON = 60 // blocs affichés dans la frise (~18 s)
const RIBBON_MIN_SCALE = 10 // hauteur max de la frise = au moins 10 tx par bloc
const RIBBON_COLOR = { proposed: 'bg-offwhite', voted: 'bg-neon', finalized: 'bg-verde', future: 'bg-offwhite/10' }
const ROW_GAP_PX = 8 // space-y-2
const ROW_PX = 56 + ROW_GAP_PX // ligne du classement (h-14) + marge
const MEDAL = ['🥇', '🥈', '🥉']
const PODIUM = ['bg-gold text-ink', 'bg-silver text-ink', 'bg-bronze text-ink'] // pastille de rang du top 3
const BAR = ['bg-gold/45', 'bg-silver/40', 'bg-bronze/40']

export default function Screen() {
  const live = useStore(liveStore)
  const [room, setRoom] = useState(INITIAL_ROOM)
  const [token, setToken] = useState(() => stored('aura.token'))
  const [qr, setQr] = useState(null)
  useEffect(() => {
    if (!room) return setQr(null)
    QRCode.toDataURL(`${location.origin}/?room=${encodeURIComponent(room)}`, { margin: 0, width: 320 }).then(setQr)
  }, [room])

  // Régie déverrouillée : le serveur a validé le code et renvoie le code de salle (→ QR code, URL partageable).
  const unlock = (nextToken, nextRoom) => {
    store('aura.token', nextToken)
    setToken(nextToken)
    if (nextRoom) {
      setRoom(nextRoom)
      history.replaceState(null, '', `${location.pathname}?room=${encodeURIComponent(nextRoom)}`)
    }
  }
  const lock = () => {
    store('aura.token', null)
    setToken(null)
  }

  // Musique dès que la régie est déverrouillée. Régie déjà ouverte au chargement (lien direct, code mémorisé) :
  // aucun geste n'a eu lieu, le navigateur bloque le son → on démarre au premier clic ou à la première touche.
  useEffect(() => {
    if (!token) return music.stop()
    music.play()
    const onGesture = () => (music.prime(), music.play())
    window.addEventListener('pointerdown', onGesture, { once: true })
    window.addEventListener('keydown', onGesture, { once: true })
    return () => {
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
    }
  }, [token])

  // Nombre de lignes du classement = ce qui tient dans la hauteur réellement disponible de la liste
  // (mesurée, pas devinée) : jamais de ligne coupée en deux, quelle que soit la taille de la fenêtre.
  const listRef = useRef(null)
  const [rows, setRows] = useState(8)
  useEffect(() => {
    const el = listRef.current
    const measure = () => setRows(Math.max(3, Math.floor((el.clientHeight + ROW_GAP_PX) / ROW_PX)))
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [])

  const phase = roundPhase(live)
  const board = useMemo(() => ranking(live), [live, liveStore.version])
  const { game, head, blocks, roundStats } = live
  // Débit instantané : moyenne des 3 derniers blocs actifs encore "frais" (< 5 blocs)
  const recent = blocks.filter((b) => head - b.n <= 5).slice(-3)
  const tps = recent.length ? recent.reduce((a, b) => a + b.txs, 0) / recent.length / (BLOCK_MS / 1000) : 0
  const stats = roundStats.round === game.round ? roundStats : { txs: 0, taps: 0, peakTxs: 0 }
  const blocksLeft = Math.max(0, game.endBlock - head)
  const maxScore = board[0]?.score || 1
  const official = live.final?.round === game.round

  // Ruban = vraie frise temporelle : RIBBON cases fixes, une par numéro de bloc (vide ou non).
  // Le serveur ne publie que les blocs contenant des tx du jeu ; on replace chacun dans sa case.
  const byNumber = new Map(blocks.map((b) => [b.n, b.txs]))
  const slots = Array.from({ length: RIBBON }, (_, i) => {
    const n = head - RIBBON + 1 + i
    return { n, txs: byNumber.get(n) ?? 0 }
  })
  // Échelle avec un plancher : en solo (1 tx par bloc) les barres restent petites au lieu de
  // toutes monter à 100 %.
  const ribbonMax = Math.max(RIBBON_MIN_SCALE, ...slots.map((s) => s.txs))

  return (
    // min-h-dvh (et non h-dvh + overflow-hidden) : si le contenu dépasse la fenêtre, c'est la PAGE
    // entière qui défile, avec une seule barre de défilement sur tout l'écran.
    <div className="bg-monad-dark grid min-h-dvh grid-cols-[1fr_19rem] gap-16 px-14 py-12">
      <section className="flex min-h-0 flex-col">
        <header className="flex items-baseline justify-between">
          <h1 className="font-display text-outline text-5xl">Aura Farm <span className="text-neon">Battle</span></h1>
          <Status phase={phase} game={game} head={head} blocksLeft={blocksLeft} official={official} />
        </header>

        {/* contain:size → le contenu de la liste n'influence pas sa hauteur : elle remplit l'espace
            restant, et c'est `rows` qui s'adapte (sinon la page grandirait avec le nombre de joueurs). */}
        <div className="relative mt-10 min-h-48 flex-1">
          <ol ref={listRef} className="absolute inset-0 overflow-hidden">
            {board.slice(0, rows).map((p, i) => (
              <li key={p.a} className="rank-row" style={{ transform: `translateY(${i * ROW_PX}px)` }}>
                <div className={`relative flex h-14 items-center gap-4 overflow-hidden rounded-2xl px-5 text-lg ${i < 3 ? 'bg-offwhite/10' : 'bg-offwhite/5'}`}>
                  <div className={`absolute inset-y-0 left-0 rounded-2xl transition-[width] duration-300 ${BAR[i] ?? 'bg-monad/55'}`} style={{ width: `${(p.score / maxScore) * 100}%` }} />
                  <span className={`font-display relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-base tabular-nums ${PODIUM[i] ?? 'opacity-60'}`}>{i + 1}</span>
                  <Brainrot stage={stageOf(p.score)} outline={1} className="relative h-9 w-9 shrink-0" />
                  <span className={`relative flex-1 truncate ${i === 0 ? 'font-bold' : ''}`}>{p.name}</span>
                  {p.boostUntil > head && <span className="relative rounded bg-neon px-1.5 py-0.5 text-[11px] font-bold text-ink">🔥 x5</span>}
                  {p.speed > 25 && <span className="relative rounded bg-rosso px-1.5 py-0.5 text-[11px] font-bold text-ink">SUS</span>}
                  <span className="relative w-20 text-right text-sm tabular-nums opacity-50">{p.speed ?? 0} / s</span>
                  <span className="font-display relative w-24 text-right text-2xl tabular-nums">{p.score.toLocaleString('fr-FR')}</span>
                </div>
              </li>
            ))}
          </ol>
          {!board.length && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <Brainrot stage={5} outline={3} className="bob h-40 w-40" />
              <p className="font-display text-outline mt-6 text-4xl">Scanne le QR code pour rejoindre</p>
              <p className="mt-2 opacity-60">ton wallet est créé automatiquement, aucun MON à avoir</p>
            </div>
          )}
          <Overlay phase={phase} game={game} head={head} board={board} official={official} />
        </div>

        {/* Ruban des blocs : une case = un bloc de 0,3 s, hauteur = transactions du jeu dans ce bloc */}
        <div className="mt-8 shrink-0">
          <div className="flex h-12 items-end gap-0.5">
            {slots.map((s) => (
              <div key={s.n} title={`bloc ${s.n} : ${s.txs} tx`} className={`flex-1 rounded-sm transition-colors duration-150 ${s.txs ? RIBBON_COLOR[blockState(live, s.n)] : 'bg-offwhite/10'}`} style={{ height: s.txs ? `${Math.max(8, (s.txs / ribbonMax) * 100)}%` : '2px' }} />
            ))}
          </div>
          <p className="label mt-3 flex justify-between">
            <span>{RIBBON} derniers blocs de 0,3 s · blanc proposé · jaune voté · vert finalisé</span>
            <span>bloc {head.toLocaleString('fr-FR')}</span>
          </p>
        </div>
      </section>

      <aside className="flex flex-col">
        <div className="shrink-0 rounded-3xl border-b-8 border-ink/30 bg-offwhite p-5 text-center text-ink">
          {qr ? (
            <img src={qr} alt="QR code pour rejoindre" className="mx-auto aspect-square max-h-[26vh] w-auto" />
          ) : (
            <p className="px-2 py-10 text-sm opacity-60">Le QR code apparaît une fois la régie déverrouillée.</p>
          )}
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] opacity-50">code</p>
          <p className="font-display text-3xl tracking-widest">{room || '—'}</p>
        </div>

        {/* Régie juste sous le QR code : toujours visible, même sur une fenêtre peu haute */}
        <div className="mt-5 shrink-0">
          {token ? <Controls phase={phase} token={token} onBadToken={lock} /> : <Unlock onUnlock={unlock} />}
          {token && <MusicToggle />}
          {!live.connected && <p className="mt-3 text-center text-xs text-rosso">reconnexion au serveur…</p>}
        </div>

        <div className="mt-10">
          <p className="font-display text-outline text-9xl leading-none tabular-nums text-neon">{tps.toFixed(0)}</p>
          <p className="label mt-2">transactions par seconde</p>
        </div>

        <dl className="mt-8 divide-y divide-offwhite/10 text-sm">
          <Line label="Pic" value={`${(stats.peakTxs / (BLOCK_MS / 1000)).toFixed(0)} tx/s`} />
          <Line label="Transactions du round" value={stats.txs.toLocaleString('fr-FR')} />
          <Line label="Coût total" value={`${(stats.txs * MON_PER_TX).toFixed(2)} MON`} />
          <Line label="Part d'un bloc Monad utilisée" value={`${(((stats.peakTxs * Number(GAS.tap)) / BLOCK_GAS_LIMIT) * 100).toFixed(2)} %`} />
          <Line label="Joueurs" value={board.length} />
        </dl>

      </aside>
    </div>
  )
}

function Status({ phase, game, head, blocksLeft, official }) {
  const cls = 'rounded-full px-5 py-2 text-right text-xl font-bold tabular-nums'
  if (phase === 'countdown') return <p className={`${cls} bg-neon text-ink`}>Départ dans {Math.ceil(((game.startBlock - head) * BLOCK_MS) / 1000)} s</p>
  if (phase === 'live') return <p className={`${cls} bg-rosso/90 text-ink`}>● LIVE · round {game.round} · {(blocksLeft * BLOCK_MS / 1000).toFixed(0)} s</p>
  if (phase === 'over') return <p className={`${cls} ${official ? 'bg-verde text-ink' : 'bg-offwhite/10 opacity-80'}`}>{official ? `Round ${game.round} finalisé` : 'Finalisation en cours'}</p>
  return <p className={`${cls} bg-offwhite/10 opacity-60`}>En attente</p>
}

/** Décompte géant avant le départ, puis podium du round quand le résultat est officiel. */
function Overlay({ phase, game, head, board, official }) {
  if (phase === 'countdown') {
    const secs = Math.max(1, Math.ceil(((game.startBlock - head) * BLOCK_MS) / 1000))
    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-3xl bg-monad-deep/80 backdrop-blur-sm">
        <p className="label">round {game.round} · prêts ?</p>
        <p key={secs} className="count-in font-display text-outline text-[16rem] leading-none text-neon">{secs}</p>
      </div>
    )
  }
  if (phase === 'over' && official && board.length) {
    const [first, ...rest] = board.slice(0, 3)
    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-3xl bg-monad-deep/90 backdrop-blur-sm">
        <div className="rise-in flex flex-col items-center">
          <p className="label">vainqueur du round {game.round}</p>
          <Brainrot stage={stageOf(first.score)} outline={4} className="bob mt-4 h-56 w-56" />
          <p className="font-display text-outline mt-4 text-6xl">🥇 {first.name}</p>
          <p className="font-display mt-2 text-4xl text-neon tabular-nums">{first.score.toLocaleString('fr-FR')} aura</p>
          <div className="mt-8 flex gap-10 text-2xl">
            {rest.map((p, i) => (
              <p key={p.a}>{MEDAL[i + 1]} {p.name} <span className="font-display tabular-nums opacity-70">{p.score.toLocaleString('fr-FR')}</span></p>
            ))}
          </div>
        </div>
      </div>
    )
  }
  return null
}

const Line = ({ label, value }) => (
  <div className="flex items-baseline justify-between py-2.5">
    <dt className="opacity-60">{label}</dt>
    <dd className="font-semibold tabular-nums">{value}</dd>
  </div>
)

const MODES = [
  { label: 'Éco · 1 tx par seconde', maxPerTx: 20, flushMs: 1000 }, // mode par défaut : le budget MON tient plusieurs rounds
  { label: 'Bloc · 1 tx par bloc (300 ms)', maxPerTx: 20, flushMs: 300 },
  { label: 'Finale · 1 tap = 1 tx', maxPerTx: 1, flushMs: 300 },
]

const postJson = async (path, body) => {
  const res = await fetch(`${SERVER_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { res, json: await res.json().catch(() => ({})) }
}

// Formulaire de régie : on y tape le code régie (ADMIN_TOKEN du fichier .env du serveur). Le serveur le valide et
// renvoie le code de salle : l'hôte n'a qu'UNE chose à connaître, et rien de secret ne reste dans l'URL projetée.
function Unlock({ onUnlock }) {
  const [value, setValue] = useState('')
  const [msg, setMsg] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    if (!value.trim()) return
    music.prime() // pendant le clic : autorise la musique qui démarrera une fois la régie déverrouillée
    try {
      const { res, json } = await postJson('/admin/check', { token: value.trim() })
      if (!res.ok) return setMsg(json.error ?? `Erreur ${res.status}`)
      onUnlock(value.trim(), json.room)
    } catch {
      setMsg('Serveur injoignable')
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <p className="label">Régie</p>
      <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Code régie" autoComplete="off" className="w-full rounded-xl bg-offwhite/10 px-3 py-2 text-sm text-offwhite outline-none placeholder:opacity-40" />
      <button className="w-full rounded-full bg-offwhite py-3 text-sm font-semibold text-ink">Déverrouiller la régie</button>
      {msg && <p className="text-xs text-rosso">{msg}</p>}
    </form>
  )
}

function MusicToggle() {
  const status = useSyncExternalStore(music.subscribe, music.status)
  const label = { on: '🔊 Musique', off: '🔇 Musique coupée', blocked: '🔈 Cliquer pour lancer la musique' }[status]
  return (
    <button onClick={() => (status === 'blocked' ? (music.prime(), music.play()) : music.toggle())} className="mt-2 w-full rounded-full bg-offwhite/10 py-2 text-xs font-semibold">
      {label}
    </button>
  )
}

function Controls({ phase, token, onBadToken }) {
  const [mode, setMode] = useState(0)
  const [seconds, setSeconds] = useState(30)
  const [msg, setMsg] = useState('')
  const post = async (path, body) => {
    try {
      const { res, json } = await postJson(path, { token, ...body })
      if (res.status === 403) return onBadToken() // code périmé (ADMIN_TOKEN changé) : retour au formulaire
      setMsg(res.ok ? '' : `Erreur : ${json.error}`)
    } catch {
      setMsg('Serveur injoignable')
    }
  }
  const start = () => post('/admin/start', { delay: 17, duration: Math.round((seconds * 1000) / BLOCK_MS), maxPerTx: MODES[mode].maxPerTx, flushMs: MODES[mode].flushMs })
  const running = phase === 'live' || phase === 'countdown'
  const field = 'rounded-xl bg-offwhite/10 px-3 py-2 text-sm text-offwhite outline-none'
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select value={mode} onChange={(e) => setMode(Number(e.target.value))} className={`${field} min-w-0 flex-1`}>
          {MODES.map((m, i) => <option key={m.label} value={i} className="text-ink">{m.label}</option>)}
        </select>
        <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className={field}>
          {[15, 20, 30, 45, 60].map((s) => <option key={s} value={s} className="text-ink">{s} s</option>)}
        </select>
      </div>
      {running ? (
        <button onClick={() => post('/admin/stop', {})} className="w-full rounded-full bg-offwhite/10 py-3 text-sm font-semibold">Arrêter le round</button>
      ) : (
        <button onClick={start} className="btn-chunky w-full bg-neon py-3 text-base font-bold text-ink">Lancer un round</button>
      )}
      {msg && <p className="text-xs text-rosso">{msg}</p>}
    </div>
  )
}
