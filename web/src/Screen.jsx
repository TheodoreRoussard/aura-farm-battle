// Écran géant projeté pendant le pitch : c'est LUI la démo.
//   /screen?room=AURA                → affichage seul
//   /screen?room=AURA&token=SECRET   → + régie (lancer / arrêter un round)
import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { BLOCK_MS, GAS, stageOf } from '../../shared/config.mjs'
import { SERVER_URL, createLive, ranking, roundPhase } from './game.js'
import { SPRITES, useStore } from './hooks.js'

const liveStore = createLive()
const params = new URLSearchParams(location.search)
const ROOM = params.get('room') ?? ''
const TOKEN = params.get('token')
const JOIN_URL = `${location.origin}/?room=${encodeURIComponent(ROOM)}`
const BLOCK_GAS_LIMIT = 150_000_000 // capacité d'un bloc Monad
const MON_PER_TX = Number(GAS.tap) * 100e-9 // gas limit × base fee plancher (100 gwei)

export default function Screen() {
  const live = useStore(liveStore)
  const [qr, setQr] = useState(null)
  useEffect(() => void QRCode.toDataURL(JOIN_URL, { margin: 1, width: 320 }).then(setQr), [])

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

  return (
    <div className="bg-tricolore grid h-full grid-cols-[1fr_22rem] gap-6 p-6">
      <section className="flex min-h-0 flex-col">
        <header className="flex items-end justify-between">
          <h1 className="font-display text-stroke text-6xl text-neon">AURA FARM BATTLE</h1>
          <Status phase={phase} game={game} head={head} blocksLeft={blocksLeft} official={official} />
        </header>

        <ol className="mt-4 flex-1 space-y-1.5 overflow-hidden">
          {board.slice(0, 12).map((p, i) => (
            <li key={p.a} className="relative flex items-center gap-3 overflow-hidden rounded-xl bg-black/50 px-3 py-1.5 text-xl">
              <div className="absolute inset-y-0 left-0 bg-verde/40 transition-[width] duration-300" style={{ width: `${(p.score / maxScore) * 100}%` }} />
              <span className="font-display relative w-8 text-right text-2xl">{i + 1}</span>
              <span className="relative text-3xl">{SPRITES[stageOf(p.score)]}</span>
              <span className="relative flex-1 truncate">{p.name}</span>
              {p.speed > 25 && <span className="relative text-base">SUS 🤖</span>}
              <span className="relative w-20 text-right text-sm opacity-70">{p.speed ?? 0} /s</span>
              <span className="font-display relative w-28 text-right text-2xl tabular-nums">{p.score.toLocaleString('fr-FR')}</span>
            </li>
          ))}
          {!board.length && <p className="pt-24 text-center text-3xl opacity-70">Scanne le QR code pour rejoindre 👉</p>}
        </ol>

        {/* Ruban des blocs : une barre = un bloc de 0,3 s, hauteur = nombre de transactions du jeu */}
        <div className="mt-3 flex h-20 items-end gap-0.5 rounded-xl bg-black/50 p-2">
          {blocks.slice(-60).map((b) => (
            <div key={b.n} title={`bloc ${b.n} : ${b.txs} tx`} className="flex-1 rounded-sm bg-neon" style={{ height: `${Math.max(4, (b.txs / Math.max(1, stats.peakTxs)) * 100)}%` }} />
          ))}
        </div>
      </section>

      <aside className="flex flex-col gap-3">
        <div className="rounded-2xl bg-white p-3 text-center text-black">
          {qr && <img src={qr} alt="QR code pour rejoindre" className="mx-auto w-full" />}
          <p className="font-display text-2xl">CODE : {ROOM || '—'}</p>
          <p className="truncate text-xs opacity-60">{JOIN_URL}</p>
        </div>
        <Stat big label="transactions / seconde" value={tps.toFixed(0)} />
        <div className="grid grid-cols-2 gap-3">
          <Stat label="pic (tx/s)" value={(stats.peakTxs / (BLOCK_MS / 1000)).toFixed(0)} />
          <Stat label="tx ce round" value={stats.txs.toLocaleString('fr-FR')} />
          <Stat label="coût total" value={`${(stats.txs * MON_PER_TX).toFixed(2)} MON`} />
          <Stat label="d'un bloc Monad utilisé" value={`${(((stats.peakTxs * Number(GAS.tap)) / BLOCK_GAS_LIMIT) * 100).toFixed(2)} %`} />
        </div>
        <p className="text-center text-xs opacity-70">bloc {head.toLocaleString('fr-FR')} · {board.length} joueurs · {live.connected ? 'flux live' : 'reconnexion…'}</p>
        {TOKEN && <Controls phase={phase} />}
      </aside>
    </div>
  )
}

function Status({ phase, game, head, blocksLeft, official }) {
  const cls = 'font-display text-stroke text-right text-4xl'
  if (phase === 'countdown') return <p className={`${cls} text-neon`}>DÉPART DANS {Math.ceil(((game.startBlock - head) * BLOCK_MS) / 1000)}</p>
  if (phase === 'live') return <p className={`${cls} text-verde`}>FIN DANS {blocksLeft} BLOCS</p>
  if (phase === 'over') return <p className={`${cls} ${official ? 'text-verde' : 'text-rosso'}`}>{official ? `ROUND ${game.round} FINALISÉ ✅` : 'FINALISATION…'}</p>
  return <p className={`${cls} opacity-70`}>EN ATTENTE</p>
}

const Stat = ({ label, value, big }) => (
  <div className="rounded-2xl bg-black/60 p-3 text-center">
    <p className={`font-display tabular-nums text-neon ${big ? 'text-7xl' : 'text-3xl'}`}>{value}</p>
    <p className="text-xs uppercase tracking-wider opacity-70">{label}</p>
  </div>
)

const MODES = [
  { label: 'Éco — 1 tx / 600 ms', maxPerTx: 20, flushMs: 600 },
  { label: 'Bloc — 1 tx / bloc (300 ms)', maxPerTx: 20, flushMs: 300 },
  { label: 'Finale — 1 tap = 1 tx', maxPerTx: 1, flushMs: 300 },
]

function Controls({ phase }) {
  const [mode, setMode] = useState(0)
  const [seconds, setSeconds] = useState(30)
  const [msg, setMsg] = useState('')
  const post = async (path, body) => {
    const res = await fetch(`${SERVER_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN, ...body }) })
    const json = await res.json().catch(() => ({}))
    setMsg(res.ok ? `ok ${json.hash?.slice(0, 10)}…` : `erreur : ${json.error}`)
  }
  const start = () => post('/admin/start', { delay: 17, duration: Math.round((seconds * 1000) / BLOCK_MS), maxPerTx: MODES[mode].maxPerTx, flushMs: MODES[mode].flushMs })
  return (
    <div className="space-y-2 rounded-2xl bg-black/70 p-3 text-sm">
      <select value={mode} onChange={(e) => setMode(Number(e.target.value))} className="w-full rounded bg-white p-1 text-black">
        {MODES.map((m, i) => <option key={m.label} value={i}>{m.label}</option>)}
      </select>
      <div className="flex gap-2">
        <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="flex-1 rounded bg-white p-1 text-black">
          {[15, 20, 30, 45, 60].map((s) => <option key={s} value={s}>{s} s</option>)}
        </select>
        <button disabled={phase === 'live' || phase === 'countdown'} onClick={start} className="flex-1 rounded bg-verde p-1 font-bold text-black disabled:opacity-40">START</button>
        <button onClick={() => post('/admin/stop', {})} className="flex-1 rounded bg-rosso p-1 font-bold">STOP</button>
      </div>
      <p className="h-4 text-xs opacity-70">{msg}</p>
    </div>
  )
}
