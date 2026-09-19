import { useEffect, useMemo, useRef, useState } from 'react'
import { formatEther } from 'viem'
import { BLOCK_MS, KIND_POWER, KIND_RATE, STAGES, powerCost, rateCost, stageOf } from '../../shared/config.mjs'
import BlockTrail from './BlockTrail.jsx'
import Brainrot from './Brainrot.jsx'
import { createLive, createPlayer, projected, ranking, roundPhase } from './game.js'
import { SHOUTS, blip, fanfare, useStore } from './hooks.js'

const liveStore = createLive()
const playerStore = createPlayer(liveStore)
playerStore.boot()

const PHASE_TEXT = {
  boot: 'Chargement du wallet',
  funding: 'Livraison de MON en cours',
  warming: 'Charging aura (3 blocs)',
  joining: 'Inscription on-chain',
}

export default function Play() {
  const live = useStore(liveStore)
  const me = useStore(playerStore)
  const [particles, setParticles] = useState([])
  const [shout, setShout] = useState(null)
  const [toast, setToast] = useState(null)
  const [drawer, setDrawer] = useState(false)
  const [squish, setSquish] = useState(0)
  const pid = useRef(0)

  const mine = live.players.get(me.address)
  const phase = roundPhase(live)
  const power = mine?.round === live.game.round ? mine.power : 1
  const rate = mine?.round === live.game.round ? mine.rate : 0
  const spent = mine?.round === live.game.round ? mine.spent : 0
  const inFlight = playerStore.optimisticTaps()
  const total = projected(mine, live) + inFlight * power // optimiste : on n'attend pas la chaîne
  const aura = total - spent
  const stage = stageOf(total)
  const board = useMemo(() => ranking(live), [live, liveStore.version])
  const rank = board.findIndex((p) => p.a === me.address) + 1

  // Évolution : secousse + nom du nouveau personnage + fanfare quand on franchit un palier
  const prevStage = useRef(stage)
  useEffect(() => {
    if (stage > prevStage.current) {
      setShout(STAGES[stage].name)
      fanfare()
      navigator.vibrate?.([60, 40, 120])
    }
    prevStage.current = stage
  }, [stage])
  useEffect(() => {
    if (!shout) return
    const t = setTimeout(() => setShout(null), 1400)
    return () => clearTimeout(t)
  }, [shout])

  // "X t'a volé la Ne place"
  const prevRank = useRef(0)
  useEffect(() => {
    if (phase === 'live' && prevRank.current && rank > prevRank.current && board[rank - 2]) {
      setToast(`${board[rank - 2].name} t'a volé la ${prevRank.current}${prevRank.current === 1 ? 're' : 'e'} place`)
      const t = setTimeout(() => setToast(null), 2200)
      prevRank.current = rank
      return () => clearTimeout(t)
    }
    prevRank.current = rank
  }, [rank, phase])

  const onTap = (e) => {
    if (!playerStore.tap()) return
    const box = e.currentTarget.getBoundingClientRect()
    const id = pid.current++
    const text = Math.random() < 0.1 ? SHOUTS[id % SHOUTS.length] : `+${power}`
    setParticles((ps) => [...ps.slice(-10), { id, x: e.clientX - box.left, y: e.clientY - box.top, text }])
    setTimeout(() => setParticles((ps) => ps.filter((p) => p.id !== id)), 700)
    setSquish((n) => n + 1)
    blip(300 + Math.min(900, (total % 60) * 15))
    navigator.vibrate?.(8)
  }

  if (me.phase === 'room') return <RoomForm onSubmit={(code) => playerStore.setRoom(code)} />
  if (me.phase === 'error')
    return (
      <Center>
        <p className="font-display text-2xl">Quelque chose a cassé</p>
        <p className="mt-3 max-w-xs text-sm opacity-70">{me.error}</p>
        <button className="mt-8 rounded-full bg-offwhite px-7 py-3 text-sm font-semibold text-ink" onPointerDown={() => playerStore.boot()}>Réessayer</button>
      </Center>
    )
  if (me.phase !== 'ready')
    return (
      <Center>
        <Brainrot stage={0} outline={3} className="h-36 w-36" />
        <p className="mt-8 animate-pulse text-base">{PHASE_TEXT[me.phase]}</p>
        <p className="label mt-2">{me.name}</p>
      </Center>
    )

  const txLeft = playerStore.txLeft()
  const canTap = playerStore.canSend()
  const next = STAGES[stage + 1]
  const stageProgress = next ? Math.min(1, (total - Number(STAGES[stage].min)) / (Number(next.min) - Number(STAGES[stage].min))) : 1

  return (
    <div className="bg-monad relative mx-auto flex h-full max-w-md flex-col overflow-hidden px-6 pb-5 pt-6">
      <header className="flex items-baseline justify-between text-sm">
        <p className="font-semibold">{me.name}</p>
        <p className="tabular-nums opacity-70">{rank ? `${rank}${rank === 1 ? 'er' : 'e'} sur ${board.length}` : 'non classé'}</p>
      </header>

      <RoundStatus phase={phase} live={live} rank={rank} />

      {/* Le personnage : toute la zone est tappable, en multi-touch (pointerdown, pas click) */}
      <main className="relative flex min-h-0 flex-1 touch-none flex-col items-center justify-center" onPointerDown={onTap}>
        <p className="font-display text-8xl leading-none tabular-nums">{total.toLocaleString('fr-FR')}</p>
        <p className="label mt-2">aura</p>
        <div key={squish} className={`squish mt-6 ${shout ? 'shake' : ''} ${canTap ? '' : 'opacity-40 grayscale'}`}>
          <Brainrot stage={stage} outline={3} className="h-52 w-52" />
        </div>
        <p className="mt-6 text-lg font-semibold">{STAGES[stage].name}</p>
        {next && (
          <div className="mt-3 w-44">
            <div className="h-1 overflow-hidden rounded-full bg-offwhite/15"><div className="h-full rounded-full bg-neon transition-[width] duration-200" style={{ width: `${stageProgress * 100}%` }} /></div>
            <p className="mt-2 text-center text-xs opacity-60">{next.name} à {Number(next.min).toLocaleString('fr-FR')}</p>
          </div>
        )}
        {particles.map((p) => (
          <span key={p.id} className="particle font-display text-2xl text-offwhite" style={{ left: p.x, top: p.y }}>{p.text}</span>
        ))}
        {shout && <span className="pop font-display absolute left-1/2 top-1/2 w-full text-center text-4xl text-neon">{shout}</span>}
      </main>

      <BlockTrail live={live} me={me} inFlight={inFlight} />

      <section className="mt-6 grid grid-cols-2 gap-3">
        <Upgrade label="Cappuccino Assassino" detail={`+1 aura par tap · niveau ${power}`} cost={Number(powerCost(power))} aura={aura} disabled={!canTap || me.buying} onBuy={() => playerStore.buy(KIND_POWER)} />
        <Upgrade label="Brr Brr Patapim" detail={`+1 aura par bloc · niveau ${rate}`} cost={Number(rateCost(rate))} aura={aura} disabled={!canTap || me.buying} onBuy={() => playerStore.buy(KIND_RATE)} />
      </section>

      <footer className="mt-5 flex items-center justify-between text-xs">
        <span className="flex gap-4">
          <button className="font-semibold underline decoration-offwhite/40 underline-offset-4" onPointerDown={() => setDrawer(true)}>Hall of Shame</button>
          <a className="underline decoration-offwhite/40 underline-offset-4 opacity-70" href={`/screen?room=${encodeURIComponent(me.room)}`} target="_blank" rel="noreferrer">Écran géant</a>
        </span>
        <p className="tabular-nums opacity-60" title={me.balance !== null ? `${formatEther(me.balance)} MON` : ''}>
          {live.connected ? `${txLeft === null ? '…' : txLeft > 999 ? '999+' : txLeft} tx restantes${me.lastLatency ? ` · ${me.lastLatency} ms` : ''}` : 'reconnexion…'}
        </p>
      </footer>

      {drawer && <Leaderboard board={board} me={me.address} onClose={() => setDrawer(false)} />}
      {toast && <div className="absolute inset-x-6 top-20 z-10 rounded-2xl bg-offwhite px-4 py-3 text-center text-sm font-semibold text-ink">{toast}</div>}
    </div>
  )
}

function RoundStatus({ phase, live, rank }) {
  const { game, head } = live
  const blocksLeft = Math.max(0, game.endBlock - head)
  let text = 'En attente du prochain round'
  let pct = 0
  if (phase === 'countdown') text = `Départ dans ${Math.ceil(((game.startBlock - head) * BLOCK_MS) / 1000)} s`
  if (phase === 'live') {
    text = `Round ${game.round} · fin dans ${blocksLeft} blocs`
    pct = (blocksLeft / (game.endBlock - game.startBlock)) * 100
  }
  if (phase === 'over') text = live.final?.round === game.round ? `Round ${game.round} finalisé · tu finis ${rank ? `${rank}${rank === 1 ? 'er' : 'e'}` : 'non classé'}` : 'Terminé · finalisation en cours'
  return (
    <div className="mt-5">
      <div className="h-1 overflow-hidden rounded-full bg-offwhite/15"><div className="h-full rounded-full bg-offwhite transition-[width] duration-300" style={{ width: `${pct}%` }} /></div>
      <p className={`mt-2 text-center text-xs ${phase === 'countdown' ? 'font-semibold text-neon' : 'opacity-70'}`}>{text}</p>
    </div>
  )
}

const Center = ({ children }) => <div className="bg-monad flex h-full flex-col items-center justify-center p-8 text-center">{children}</div>

function Upgrade({ label, detail, cost, aura, disabled, onBuy }) {
  const ok = !disabled && aura >= cost
  return (
    <button disabled={!ok} onPointerDown={(e) => (e.stopPropagation(), ok && onBuy())} className={`rounded-2xl px-4 py-3 text-left transition-colors ${ok ? 'bg-offwhite text-ink active:bg-offwhite/80' : 'panel text-offwhite/55'}`}>
      <p className="text-sm font-semibold leading-tight">{label}</p>
      <p className="mt-1 text-[11px] opacity-70">{detail}</p>
      <p className="mt-2 text-sm font-bold tabular-nums">{cost} aura</p>
    </button>
  )
}

function Leaderboard({ board, me, onClose }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-monad-deep/95 px-6 pb-5 pt-8 backdrop-blur" onPointerDown={onClose}>
      <h2 className="font-display text-3xl">Hall of Shame</h2>
      <ol className="mt-6 flex-1 space-y-1 overflow-y-auto text-sm">
        {board.slice(0, 30).map((p, i) => (
          <li key={p.a} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${p.a === me ? 'bg-offwhite text-ink' : ''}`}>
            <span className="w-5 text-right tabular-nums opacity-60">{i + 1}</span>
            <Brainrot stage={stageOf(p.score)} outline={1} className="h-7 w-7 shrink-0" />
            <span className="flex-1 truncate">{p.name}</span>
            {p.speed > 25 && <span className="rounded bg-rosso px-1.5 py-0.5 text-[10px] font-bold text-ink" title="plus de 25 aura par seconde">SUS</span>}
            <span className="font-semibold tabular-nums">{p.score.toLocaleString('fr-FR')}</span>
          </li>
        ))}
        {!board.length && <p className="pt-10 text-center opacity-60">Personne n'a encore tapé ce round.</p>}
      </ol>
      <p className="label pt-4 text-center">toucher pour fermer</p>
    </div>
  )
}

function RoomForm({ onSubmit }) {
  const [code, setCode] = useState('')
  return (
    <Center>
      <h1 className="font-display text-4xl">Aura Farm Battle</h1>
      <p className="mt-3 text-sm opacity-70">Entre le code affiché sur l'écran géant</p>
      <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" className="mt-8 w-44 rounded-2xl bg-offwhite/10 p-3 text-center text-2xl font-bold uppercase tracking-widest outline-none placeholder:opacity-30" placeholder="CODE" />
      <button className="mt-4 rounded-full bg-offwhite px-8 py-3 text-sm font-semibold text-ink" onPointerDown={() => code && onSubmit(code)}>Rejoindre</button>
      <a className="mt-12 text-xs underline decoration-offwhite/40 underline-offset-4 opacity-70" href="/screen">Tu animes la partie ? Écran géant et régie</a>
    </Center>
  )
}
