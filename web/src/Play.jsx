import { useEffect, useMemo, useRef, useState } from 'react'
import { formatEther } from 'viem'
import { BLOCK_MS, KIND_POWER, KIND_RATE, STAGES, powerCost, rateCost, stageOf } from '../../shared/config.mjs'
import { createLive, createPlayer, projected, ranking, roundPhase } from './game.js'
import Brainrot from './Brainrot.jsx'
import { SHOUTS, blip, fanfare, useStore } from './hooks.js'

const liveStore = createLive()
const playerStore = createPlayer(liveStore)
playerStore.boot()

const PHASE_TEXT = {
  boot: 'Chargement du wallet...',
  funding: 'Livraison de MON en cours... 🍕',
  warming: '🔥 Charging aura... (3 blocs)',
  joining: 'Inscription on-chain...',
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
  const total = projected(mine, live) + playerStore.optimisticTaps() * power // optimiste : on n'attend pas la chaîne
  const aura = total - spent
  const stage = stageOf(total)
  const board = useMemo(() => ranking(live), [live, liveStore.version])
  const rank = board.findIndex((p) => p.a === me.address) + 1

  // Évolution : secousse + cri + fanfare quand on franchit un palier
  const prevStage = useRef(stage)
  useEffect(() => {
    if (stage > prevStage.current) {
      setShout(`${STAGES[stage].name.toUpperCase()} !`)
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

  // "X t'a volé la Ne place !"
  const prevRank = useRef(0)
  useEffect(() => {
    if (phase === 'live' && prevRank.current && rank > prevRank.current && board[rank - 2]) {
      setToast(`⚠️ ${board[rank - 2].name} t'a volé la ${prevRank.current}${prevRank.current === 1 ? 're' : 'e'} place !`)
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
    const text = Math.random() < 0.12 ? SHOUTS[id % SHOUTS.length] : `+${power}`
    setParticles((ps) => [...ps.slice(-14), { id, x: e.clientX - box.left, y: e.clientY - box.top, text, rot: `${(Math.random() * 40 - 20) | 0}deg` }])
    setTimeout(() => setParticles((ps) => ps.filter((p) => p.id !== id)), 700)
    setSquish((n) => n + 1)
    blip(300 + Math.min(900, (total % 60) * 15))
    navigator.vibrate?.(8)
  }

  if (me.phase === 'room') return <RoomForm onSubmit={(code) => playerStore.setRoom(code)} />
  if (me.phase === 'error')
    return (
      <Center>
        <p className="text-4xl">💀</p>
        <p className="mt-2 text-rosso">{me.error}</p>
        <button className="mt-4 rounded-xl bg-white px-5 py-3 font-bold text-black" onPointerDown={() => playerStore.boot()}>Réessayer</button>
      </Center>
    )
  if (me.phase !== 'ready') return <Center><p className="animate-pulse text-xl">{PHASE_TEXT[me.phase]}</p><p className="mt-3 text-sm opacity-60">{me.name}</p></Center>

  const blocksLeft = Math.max(0, live.game.endBlock - live.head)
  const txLeft = playerStore.txLeft()
  const canTap = playerStore.canSend()

  return (
    <div className="bg-tricolore relative mx-auto flex h-full max-w-md flex-col overflow-hidden">
      {/* Barre du haut : identité, énergie (MON du wallet jetable), latence */}
      <header className="flex items-center justify-between gap-2 px-4 pt-3 text-xs">
        <div>
          <p className="font-display text-base tracking-wide">{me.name}</p>
          <p className="opacity-60">{rank ? `#${rank} / ${board.length}` : 'pas encore classé'}</p>
        </div>
        <div className="text-right">
          <p title={me.balance !== null ? `${formatEther(me.balance)} MON` : ''}>⚡ {txLeft === null ? '…' : txLeft > 999 ? '999+' : txLeft} tx restantes</p>
          <p className={live.connected ? 'text-verde' : 'text-rosso'}>
            {live.connected ? (me.lastLatency ? `⛓ confirmé en ${me.lastLatency} ms` : '⛓ connecté') : 'reconnexion…'}
          </p>
        </div>
      </header>

      <RoundBanner phase={phase} live={live} blocksLeft={blocksLeft} rank={rank} />

      {/* Le personnage : toute la zone est tappable, en multi-touch (pointerdown, pas click) */}
      <main className="relative flex flex-1 touch-none flex-col items-center justify-center" onPointerDown={onTap}>
        <p className="font-display text-stroke text-7xl text-neon tabular-nums">{total.toLocaleString('fr-FR')}</p>
        <p className="font-display text-sm tracking-widest opacity-80">AURA</p>
        <div key={squish} className={`squish mt-2 ${shout ? 'shake' : ''} ${canTap ? '' : 'opacity-40 grayscale'}`}><Brainrot stage={stage} outline={4} className="h-52 w-52" /></div>
        <p className="font-display mt-2 text-2xl text-stroke">{STAGES[stage].name}</p>
        {stage < STAGES.length - 1 && <p className="text-xs opacity-70">prochaine évolution : {Number(STAGES[stage + 1].min).toLocaleString('fr-FR')}</p>}
        {particles.map((p) => (
          <span key={p.id} className="particle font-display text-stroke text-3xl text-white" style={{ left: p.x, top: p.y, '--rot': p.rot }}>{p.text}</span>
        ))}
        {shout && <span className="pop font-display text-stroke absolute left-1/2 top-1/2 w-full text-center text-5xl text-rosso">{shout}</span>}
      </main>

      <p className="px-4 text-center text-[11px] opacity-70">
        {me.txSent} tx envoyées · {me.txSeen} confirmées · {playerStore.optimisticTaps()} taps en vol · 1 tx / {live.game.maxPerTx === 1 ? 'tap' : `${live.flushMs} ms`}
      </p>

      <section className="grid grid-cols-2 gap-2 p-3">
        <Upgrade label="☕ Cappuccino Assassino" detail={`+1 aura / tap (actuel ${power})`} cost={Number(powerCost(power))} aura={aura} disabled={!canTap || me.buying} onBuy={() => playerStore.buy(KIND_POWER)} />
        <Upgrade label="🌳 Brr Brr Patapim" detail={`+1 aura / bloc (actuel ${rate})`} cost={Number(rateCost(rate))} aura={aura} disabled={!canTap || me.buying} onBuy={() => playerStore.buy(KIND_RATE)} />
      </section>

      <button className="font-display bg-black/60 py-3 text-lg tracking-wider" onPointerDown={() => setDrawer(true)}>🏆 HALL OF SHAME</button>
      {drawer && <Leaderboard board={board} me={me.address} onClose={() => setDrawer(false)} />}
      {toast && <div className="font-display absolute inset-x-3 top-24 rounded-xl border-2 border-black bg-neon p-3 text-center text-black shadow-[4px_4px_0_#000]">{toast}</div>}
    </div>
  )
}

function RoundBanner({ phase, live, blocksLeft, rank }) {
  const { game, head } = live
  if (phase === 'countdown') return <Banner className="bg-neon text-black">DÉPART DANS {Math.ceil(((game.startBlock - head) * BLOCK_MS) / 1000)}…</Banner>
  if (phase === 'live') {
    const pct = (blocksLeft / (game.endBlock - game.startBlock)) * 100
    return (
      <div className="mx-4 mt-2">
        <div className="h-3 overflow-hidden rounded-full border border-white/40 bg-black/50"><div className="h-full bg-verde transition-[width] duration-300" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1 text-center text-xs opacity-80">fin dans {blocksLeft} blocs (~{Math.ceil((blocksLeft * BLOCK_MS) / 1000)} s) · round {game.round}</p>
      </div>
    )
  }
  if (phase === 'over') return <Banner className="bg-rosso">{live.final?.round === game.round ? `FINALISÉ ✅ — tu finis #${rank || '?'}` : 'FINI ! finalisation…'}</Banner>
  return <Banner className="bg-white/10">En attente du prochain round… regarde l'écran géant 👀</Banner>
}

const Banner = ({ className, children }) => <p className={`font-display mx-4 mt-2 rounded-xl px-3 py-2 text-center text-lg tracking-wide ${className}`}>{children}</p>
const Center = ({ children }) => <div className="bg-tricolore flex h-full flex-col items-center justify-center p-6 text-center">{children}</div>

function Upgrade({ label, detail, cost, aura, disabled, onBuy }) {
  const ok = !disabled && aura >= cost
  return (
    <button disabled={!ok} onPointerDown={(e) => (e.stopPropagation(), ok && onBuy())} className={`rounded-xl border-2 border-black p-2 text-left shadow-[3px_3px_0_#000] ${ok ? 'bg-white text-black active:translate-y-0.5' : 'bg-white/20 text-white/60'}`}>
      <p className="font-display text-sm">{label}</p>
      <p className="text-[11px]">{detail}</p>
      <p className="font-display text-base">{cost} aura</p>
    </button>
  )
}

function Leaderboard({ board, me, onClose }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-black/90 p-4" onPointerDown={onClose}>
      <h2 className="font-display text-stroke text-center text-3xl text-neon">HALL OF SHAME</h2>
      <ol className="mt-3 flex-1 space-y-1 overflow-y-auto text-sm">
        {board.slice(0, 30).map((p, i) => (
          <li key={p.a} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${p.a === me ? 'bg-neon text-black' : 'bg-white/10'}`}>
            <span className="font-display w-7 text-right">{i + 1}</span>
            <Brainrot stage={stageOf(p.score)} outline={1} className="h-8 w-8 shrink-0" />
            <span className="flex-1 truncate">{p.name}</span>
            {p.speed > 25 && <span title="plus de 25 aura/s">SUS 🤖</span>}
            <span className="text-xs opacity-70">{p.speed ?? 0}/s</span>
            <span className="font-display tabular-nums">{p.score.toLocaleString('fr-FR')}</span>
          </li>
        ))}
        {!board.length && <p className="pt-10 text-center opacity-60">Personne n'a encore tapé ce round.</p>}
      </ol>
      <p className="pt-2 text-center text-xs opacity-60">touche pour fermer</p>
    </div>
  )
}

function RoomForm({ onSubmit }) {
  const [code, setCode] = useState('')
  return (
    <Center>
      <h1 className="font-display text-stroke text-5xl text-neon">AURA FARM BATTLE</h1>
      <p className="mt-4">Code de la salle (affiché sur l'écran géant)</p>
      <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" className="mt-3 w-48 rounded-xl border-2 border-black bg-white p-3 text-center text-2xl font-bold uppercase text-black" />
      <button className="font-display mt-4 rounded-xl border-2 border-black bg-verde px-8 py-3 text-2xl text-black shadow-[4px_4px_0_#000]" onPointerDown={() => code && onSubmit(code)}>ANDIAMO</button>
    </Center>
  )
}
