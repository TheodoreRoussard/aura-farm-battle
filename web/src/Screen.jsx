// Écran géant projeté pendant le pitch : c'est LUI la démo.
//   /screen?room=AURA                → affichage seul
//   /screen?room=AURA&token=SECRET   → + régie (lancer / arrêter un round)
import QRCode from 'qrcode'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BLOCK_MS, GAS, stageOf } from '../../shared/config.mjs'
import Brainrot from './Brainrot.jsx'
import { SERVER_URL, blockState, createLive, ranking, roundPhase } from './game.js'
import { useStore } from './hooks.js'

const liveStore = createLive()
const params = new URLSearchParams(location.search)
const ROOM = params.get('room') ?? ''
const TOKEN = params.get('token')
const JOIN_URL = `${location.origin}/?room=${encodeURIComponent(ROOM)}`
const BLOCK_GAS_LIMIT = 150_000_000 // capacité d'un bloc Monad
const MON_PER_TX = Number(GAS.tap) * 100e-9 // gas limit × base fee plancher (100 gwei)
const RIBBON = 60 // blocs affichés dans la frise (~18 s)
const RIBBON_MIN_SCALE = 10 // hauteur max de la frise = au moins 10 tx par bloc
const RIBBON_COLOR = { proposed: 'bg-offwhite', voted: 'bg-neon', finalized: 'bg-verde', future: 'bg-offwhite/10' }
const ROW_GAP_PX = 8 // space-y-2
const ROW_PX = 56 + ROW_GAP_PX // ligne du classement (h-14) + marge

export default function Screen() {
  const live = useStore(liveStore)
  const [qr, setQr] = useState(null)
  useEffect(() => void QRCode.toDataURL(JOIN_URL, { margin: 0, width: 320 }).then(setQr), [])

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
          <h1 className="font-display text-4xl">Aura Farm Battle</h1>
          <Status phase={phase} game={game} head={head} blocksLeft={blocksLeft} official={official} />
        </header>

        {/* contain:size → le contenu de la liste n'influence pas sa hauteur : elle remplit l'espace
            restant, et c'est `rows` qui s'adapte (sinon la page grandirait avec le nombre de joueurs). */}
        <ol ref={listRef} className="mt-10 min-h-48 flex-1 space-y-2 overflow-hidden [contain:size]">
          {board.slice(0, rows).map((p, i) => (
            <li key={p.a} className="relative flex h-14 items-center gap-4 overflow-hidden rounded-2xl bg-offwhite/5 px-5 text-lg">
              <div className="absolute inset-y-0 left-0 rounded-2xl bg-monad/55 transition-[width] duration-300" style={{ width: `${(p.score / maxScore) * 100}%` }} />
              <span className="relative w-6 text-right tabular-nums opacity-60">{i + 1}</span>
              <Brainrot stage={stageOf(p.score)} outline={1} className="relative h-9 w-9 shrink-0" />
              <span className="relative flex-1 truncate">{p.name}</span>
              {p.speed > 25 && <span className="relative rounded bg-rosso px-1.5 py-0.5 text-[11px] font-bold text-ink">SUS</span>}
              <span className="relative w-20 text-right text-sm tabular-nums opacity-50">{p.speed ?? 0} / s</span>
              <span className="font-display relative w-24 text-right text-2xl tabular-nums">{p.score.toLocaleString('fr-FR')}</span>
            </li>
          ))}
          {!board.length && <p className="pt-32 text-center text-2xl opacity-50">Scanne le QR code pour rejoindre la partie</p>}
        </ol>

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
        <div className="shrink-0 rounded-3xl bg-offwhite p-5 text-center text-ink">
          {qr && <img src={qr} alt="QR code pour rejoindre" className="mx-auto aspect-square max-h-[26vh] w-auto" />}
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] opacity-50">code</p>
          <p className="font-display text-3xl tracking-widest">{ROOM || '—'}</p>
        </div>

        <div className="mt-10">
          <p className="font-display text-8xl leading-none tabular-nums">{tps.toFixed(0)}</p>
          <p className="label mt-2">transactions par seconde</p>
        </div>

        <dl className="mt-8 divide-y divide-offwhite/10 text-sm">
          <Line label="Pic" value={`${(stats.peakTxs / (BLOCK_MS / 1000)).toFixed(0)} tx/s`} />
          <Line label="Transactions du round" value={stats.txs.toLocaleString('fr-FR')} />
          <Line label="Coût total" value={`${(stats.txs * MON_PER_TX).toFixed(2)} MON`} />
          <Line label="Part d'un bloc Monad utilisée" value={`${(((stats.peakTxs * Number(GAS.tap)) / BLOCK_GAS_LIMIT) * 100).toFixed(2)} %`} />
          <Line label="Joueurs" value={board.length} />
        </dl>

        <div className="mt-auto pt-8">
          {TOKEN && <Controls phase={phase} />}
          {!live.connected && <p className="mt-3 text-center text-xs text-rosso">reconnexion au serveur…</p>}
        </div>
      </aside>
    </div>
  )
}

function Status({ phase, game, head, blocksLeft, official }) {
  const cls = 'text-right text-xl font-semibold tabular-nums'
  if (phase === 'countdown') return <p className={`${cls} text-neon`}>Départ dans {Math.ceil(((game.startBlock - head) * BLOCK_MS) / 1000)} s</p>
  if (phase === 'live') return <p className={cls}>Round {game.round} · fin dans {blocksLeft} blocs</p>
  if (phase === 'over') return <p className={`${cls} ${official ? 'text-verde' : 'opacity-70'}`}>{official ? `Round ${game.round} finalisé` : 'Finalisation en cours'}</p>
  return <p className={`${cls} opacity-50`}>En attente</p>
}

const Line = ({ label, value }) => (
  <div className="flex items-baseline justify-between py-2.5">
    <dt className="opacity-60">{label}</dt>
    <dd className="font-semibold tabular-nums">{value}</dd>
  </div>
)

const MODES = [
  { label: 'Éco · 1 tx toutes les 600 ms', maxPerTx: 20, flushMs: 600 },
  { label: 'Bloc · 1 tx par bloc (300 ms)', maxPerTx: 20, flushMs: 300 },
  { label: 'Finale · 1 tap = 1 tx', maxPerTx: 1, flushMs: 300 },
]

function Controls({ phase }) {
  const [mode, setMode] = useState(0)
  const [seconds, setSeconds] = useState(30)
  const [msg, setMsg] = useState('')
  const post = async (path, body) => {
    const res = await fetch(`${SERVER_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN, ...body }) })
    const json = await res.json().catch(() => ({}))
    setMsg(res.ok ? '' : `Erreur : ${json.error}`)
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
        <button onClick={start} className="w-full rounded-full bg-offwhite py-3 text-sm font-semibold text-ink">Lancer un round</button>
      )}
      {msg && <p className="text-xs text-rosso">{msg}</p>}
    </div>
  )
}
