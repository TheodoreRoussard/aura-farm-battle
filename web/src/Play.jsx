import { useEffect, useMemo, useRef, useState } from 'react'
import { formatEther } from 'viem'
import { BLOCK_MS, BONUS_GAP, BOOST_MULT, STAGES, UPGRADES, boostBlocks, levelsOf, stageOf, tapValue } from '../../shared/config.mjs'
import BlockTrail from './BlockTrail.jsx'
import Brainrot from './Brainrot.jsx'
import { createLive, createPlayer, projected, ranking, roundPhase } from './game.js'
import { NAME_MAX } from '../../shared/names.mjs'
import { SHOUTS, blip, fanfare, useStore } from './hooks.js'

const liveStore = createLive()
const playerStore = createPlayer(liveStore)
playerStore.boot()

const MEDAL = ['🥇', '🥈', '🥉']
const ordinal = (n) => `${n}${n === 1 ? 'er' : 'e'}`

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
  const [editName, setEditName] = useState(false)
  const [squish, setSquish] = useState(0)
  const pid = useRef(0)

  const mine = live.players.get(me.address)
  const phase = roundPhase(live)
  const lv = levelsOf(mine, live.game.round)
  const boostOn = playerStore.boosted()
  const perTap = Math.round(tapValue(lv, boostOn))
  const inFlight = playerStore.optimisticTaps()
  const total = projected(mine, live) + Math.round(playerStore.optimisticAura()) // optimiste : on n'attend pas la chaîne
  const confirmed = projected(mine, live) // aura vue on-chain : c'est elle que buy() compare au seuil
  const boostLeftMs = Math.max(me.boostEnd - Date.now(), ((lv.boostUntil ?? 0) - live.head) * BLOCK_MS)
  const boostTotalMs = boostBlocks(lv.magnet) * BLOCK_MS
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
    if (phase === 'live' && prevRank.current && rank > prevRank.current && board[rank - 2])
      setToast({ id: Date.now(), text: `${board[rank - 2].name} t'a volé la ${prevRank.current}${prevRank.current === 1 ? 're' : 'e'} place` })
    prevRank.current = rank
    if (phase !== 'live') setToast(null)
  }, [rank, phase])
  // Minuteur propre à chaque notification : un changement de rang ne l'annule plus (sinon elle restait affichée).
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  // Bonus x5 : une bulle apparaît à un endroit aléatoire, le joueur la touche → claimBonus() on-chain.
  // Le contrat impose un repos entre deux bonus : pas de bulle pendant ce temps.
  const [orb, setOrb] = useState(null)
  const nextOk = useRef(0)
  const [, tick] = useState(0)
  useEffect(() => {
    if (phase !== 'live' || me.phase !== 'ready') return setOrb(null)
    let timer
    const schedule = (min, max) => {
      const wait = Math.max(min + Math.random() * (max - min), nextOk.current - Date.now())
      timer = setTimeout(() => {
        setOrb({ id: Date.now(), x: 12 + Math.random() * 76, y: 8 + Math.random() * 68 })
        timer = setTimeout(() => (setOrb(null), schedule(5000, 9000)), 4000)
      }, wait)
    }
    schedule(4000, 8000)
    return () => clearTimeout(timer)
  }, [phase, live.game.round, me.phase])
  useEffect(() => {
    if (!boostOn) return
    const t = setInterval(() => tick((n) => n + 1), 150) // fait tomber la barre du bonus et l'éteint à la fin
    return () => clearInterval(t)
  }, [boostOn])
  const claimOrb = (e) => {
    e.stopPropagation() // la bulle n'est pas un tap
    setOrb(null)
    nextOk.current = Date.now() + (boostBlocks(lv.magnet) + BONUS_GAP) * BLOCK_MS
    setShout(`BONUS x${BOOST_MULT} !`)
    fanfare()
    navigator.vibrate?.([30, 30, 60])
    playerStore.claimBonus()
  }

  const onTap = (e) => {
    if (!playerStore.tap()) return
    const box = e.currentTarget.getBoundingClientRect()
    const id = pid.current++
    const text = Math.random() < 0.1 ? SHOUTS[id % SHOUTS.length] : `+${perTap}`
    setParticles((ps) => [...ps.slice(-12), { id, x: e.clientX - box.left, y: e.clientY - box.top, text, dx: Math.round((Math.random() - 0.5) * 90), shout: text !== `+${perTap}` }])
    setTimeout(() => setParticles((ps) => ps.filter((p) => p.id !== id)), 800)
    setSquish((n) => n + 1)
    blip(300 + Math.min(900, (total % 60) * 15))
    navigator.vibrate?.(8)
  }

  // Pseudo demandé au premier lancement (le wallet se prépare pendant ce temps), modifiable ensuite.
  if ((!me.named || editName) && me.phase !== 'error')
    return <NameForm initial={me.named ? me.name : ''} placeholder={me.name} onSubmit={(n) => playerStore.setName(n) && setEditName(false)} onCancel={me.named ? () => setEditName(false) : null} />
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
      <header className="flex items-center justify-between text-sm">
        <button onPointerDown={() => setEditName(true)} className="truncate rounded-full bg-offwhite/15 px-3 py-1.5 font-semibold">{me.name} ✏️</button>
        <button onPointerDown={() => setDrawer(true)} className={`shrink-0 rounded-full px-3 py-1.5 font-bold tabular-nums ${rank === 1 ? 'bg-gold text-ink' : 'bg-offwhite/15'}`}>
          {rank ? `${MEDAL[rank - 1] ?? '🏁'} ${ordinal(rank)} / ${board.length}` : 'non classé'}
        </button>
      </header>

      <RoundStatus phase={phase} live={live} rank={rank} />

      {/* Le personnage : toute la zone est tappable, en multi-touch (pointerdown, pas click) */}
      <main className={`relative flex min-h-0 flex-1 touch-none flex-col items-center justify-center ${boostOn ? 'boost-on' : ''}`} onPointerDown={onTap}>
        {boostOn && (
          <div className="pointer-events-none absolute right-0 top-0 z-10 flex flex-col items-end">
            <p className="font-display text-outline pop-soft text-3xl text-neon">🔥 AURA x{BOOST_MULT}</p>
            <div className="mt-1 h-2 w-32 overflow-hidden rounded-full bg-offwhite/20"><div className="h-full rounded-full bg-neon" style={{ width: `${Math.min(100, (boostLeftMs / boostTotalMs) * 100)}%` }} /></div>
          </div>
        )}
        {(phase === 'live' || phase === 'countdown') && <MiniBoard board={board} me={me.address} />}
        {orb && (
          <button key={orb.id} onPointerDown={claimOrb} className="orb absolute z-20" style={{ left: `${orb.x}%`, top: `${orb.y}%` }} aria-label="Bonus aura">
            <svg className="orb-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" pathLength="100" /></svg>
            <span className="text-3xl">⚡</span>
          </button>
        )}
        {/* Pendant le décompte et l'écran de résultat, l'overlay prend la place du personnage (pas de fond sombre par-dessus). */}
        <div className={`flex flex-col items-center ${phase === 'countdown' || phase === 'over' ? 'invisible' : ''}`}>
          <p key={total} className="font-display text-outline bump text-8xl leading-none tabular-nums">{total.toLocaleString('fr-FR')}</p>
          <p className="label mt-1">aura</p>
          <div className="relative mt-5 flex h-56 w-56 items-center justify-center">
            <div className="aura-halo" style={{ '--lvl': stage }} />
            {stage >= 2 && <AuraRays />}
            <div className={canTap ? 'bob' : ''}>
              <div key={squish} className={`squish ${shout ? 'shake' : ''} ${canTap ? '' : 'opacity-40 grayscale'}`}>
                <Brainrot stage={stage} outline={3} className="h-52 w-52" />
              </div>
            </div>
          </div>
          <p className="font-display text-outline mt-4 text-2xl">{STAGES[stage].name}</p>
          {next && (
            <div className="mt-3 w-52">
              <div className="h-3 overflow-hidden rounded-full bg-offwhite/15 p-0.5"><div className="stripes h-full rounded-full bg-neon transition-[width] duration-200" style={{ width: `${Math.max(4, stageProgress * 100)}%` }} /></div>
              <p className="mt-1.5 text-center text-xs opacity-70">→ {next.name} à {Number(next.min).toLocaleString('fr-FR')}</p>
            </div>
          )}
        </div>
        {particles.map((p) => (
          <span key={p.id}>
            <span className="ripple" style={{ left: p.x, top: p.y }} />
            <span className={`particle2 font-display ${p.shout ? 'text-2xl text-neon' : 'text-3xl text-offwhite'}`} style={{ left: p.x, top: p.y, '--dx': `${p.dx}px` }}>{p.text}</span>
          </span>
        ))}
        {shout && <span className="pop font-display text-outline absolute left-1/2 top-1/2 w-full text-center text-5xl text-neon">{shout}</span>}
        <RoundOverlay phase={phase} live={live} rank={rank} total={total} count={board.length} onBoard={() => setDrawer(true)} />
      </main>

      <BlockTrail live={live} me={me} inFlight={inFlight} />

      <section className="-mx-6 mt-5 flex snap-x gap-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none]">
        {UPGRADES.map((u) => {
          const level = lv[u.key]
          return <Upgrade key={u.kind} icon={u.icon} label={u.label} detail={u.detail(level)} cost={Number(u.cost(level))} maxed={level >= u.max} total={total} confirmed={confirmed} disabled={!canTap || me.buying} onBuy={() => playerStore.buy(u.kind)} />
        })}
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
      {toast && <div key={toast.id} className="pop-soft pointer-events-none absolute inset-x-6 top-20 z-10 rounded-2xl bg-offwhite px-4 py-3 text-center text-sm font-semibold text-ink">{toast.text}</div>}
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
      <div className="h-3 overflow-hidden rounded-full bg-offwhite/15 p-0.5"><div className={`h-full rounded-full transition-[width] duration-300 ${pct < 20 ? 'bg-rosso' : 'bg-offwhite'}`} style={{ width: `${pct}%` }} /></div>
      <p className={`mt-2 text-center text-xs ${phase === 'countdown' ? 'font-semibold text-neon' : 'opacity-80'}`}>{text}</p>
    </div>
  )
}

const Center = ({ children }) => <div className="bg-monad flex h-full flex-col items-center justify-center p-8 text-center">{children}</div>

// Les améliorations se DÉBLOQUENT quand l'aura totale atteint le seuil : rien n'est dépensé.
// Le bouton attend l'aura confirmée on-chain (sinon le contrat refuserait et le niveau ne bougerait pas).
function Upgrade({ icon, label, detail, cost, maxed, total, confirmed, disabled, onBuy }) {
  const ok = !disabled && !maxed && confirmed >= cost
  const fill = Math.max(0, Math.min(1, total / cost))
  return (
    <button disabled={!ok} onClick={() => ok && onBuy()} className={`btn-chunky relative w-40 shrink-0 snap-start overflow-hidden px-3 py-3 text-left ${ok ? 'btn-ready' : 'bg-offwhite/10 text-offwhite/75'}`}>
      {!ok && !maxed && <div className="absolute inset-y-0 left-0 bg-offwhite/10 transition-[width] duration-200" style={{ width: `${fill * 100}%` }} />}
      <div className="relative flex items-center gap-2">
        <span className="text-2xl leading-none">{icon}</span>
        <p className="text-[13px] font-bold leading-tight">{label}</p>
      </div>
      <p className="relative mt-1.5 text-[11px] opacity-75">{detail}</p>
      <p className="font-display relative mt-1 text-lg tabular-nums">{maxed ? 'MAX' : ok ? 'Débloquer !' : `🔒 ${cost.toLocaleString('fr-FR')}`}</p>
    </button>
  )
}

// Rayons derrière le personnage, en SVG : un `mask-image` CSS animé s'affiche en grand carré noir
// sur certains GPU de téléphone. Le fondu vient du dégradé radial du remplissage.
const RAYS = Array.from({ length: 15 }, (_, i) => {
  const pt = (deg) => `${(50 + 50 * Math.cos((deg * Math.PI) / 180)).toFixed(2)} ${(50 + 50 * Math.sin((deg * Math.PI) / 180)).toFixed(2)}`
  return `M50 50L${pt(i * 24)}L${pt(i * 24 + 8)}Z`
}).join('')
const AuraRays = () => (
  <svg viewBox="0 0 100 100" className="aura-rays" aria-hidden="true">
    <defs>
      <radialGradient id="ray-fade" cx="50%" cy="50%" r="50%">
        <stop offset="0.22" stopColor="currentColor" stopOpacity="0" />
        <stop offset="0.4" stopColor="currentColor" />
        <stop offset="0.7" stopColor="currentColor" stopOpacity="0" />
      </radialGradient>
    </defs>
    <path d={RAYS} fill="url(#ray-fade)" />
  </svg>
)

/** Top 3 en direct, en petit dans le coin : les lignes glissent quand quelqu'un en double un autre. */
const MINI_ROW_PX = 22
function MiniBoard({ board, me }) {
  const top = board.slice(0, 3)
  if (!top.length) return null
  return (
    <ol className="pointer-events-none absolute left-0 top-0 z-10 w-40 text-xs" style={{ height: top.length * MINI_ROW_PX }}>
      {top.map((p, i) => (
        <li key={p.a} className="rank-row" style={{ transform: `translateY(${i * MINI_ROW_PX}px)` }}>
          <div className={`flex h-5 items-center gap-1.5 rounded-full px-2 ${p.a === me ? 'bg-neon font-bold text-ink' : 'bg-offwhite/15'}`}>
            <span>{MEDAL[i]}</span>
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="font-display tabular-nums">{p.score.toLocaleString('fr-FR')}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Plein écran par-dessus le personnage : décompte 3-2-1, GO, puis résultat du round. */
function RoundOverlay({ phase, live, rank, total, count, onBoard }) {
  const { game, head } = live
  const [go, setGo] = useState(false)
  useEffect(() => {
    if (phase !== 'live') return
    setGo(true)
    const t = setTimeout(() => setGo(false), 900)
    return () => clearTimeout(t)
  }, [phase, game.round])

  if (phase === 'countdown') {
    const secs = Math.max(1, Math.ceil(((game.startBlock - head) * BLOCK_MS) / 1000))
    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
        <p className="label">round {game.round} · prépare-toi</p>
        <p key={secs} className="count-in font-display text-outline text-[10rem] leading-none text-neon">{secs}</p>
      </div>
    )
  }
  if (go) return <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><p className="go-in font-display text-outline text-8xl text-neon">GO !</p></div>
  if (phase === 'over') {
    const official = live.final?.round === game.round
    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6 text-center" onPointerDown={(e) => e.stopPropagation()}>
        <div className="rise-in flex flex-col items-center">
          <p className="label">round {game.round} {official ? 'finalisé' : 'terminé'}</p>
          <p className="mt-3 text-7xl leading-none">{rank && rank <= 3 ? MEDAL[rank - 1] : '🏁'}</p>
          <p className="font-display text-outline mt-3 text-5xl">{rank ? `${ordinal(rank)} sur ${count}` : 'non classé'}</p>
          <p className="mt-2 text-lg opacity-80"><span className="font-display text-neon">{total.toLocaleString('fr-FR')}</span> aura</p>
          {!official && <p className="mt-3 animate-pulse text-xs opacity-60">confirmation on-chain…</p>}
          <button onPointerDown={onBoard} className="btn-chunky mt-8 bg-offwhite px-8 py-3 text-sm font-bold text-ink">Voir le classement</button>
        </div>
      </div>
    )
  }
  return null
}

function Leaderboard({ board, me, onClose }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-monad-deep/95 px-6 pb-5 pt-8 backdrop-blur" onPointerDown={onClose}>
      <h2 className="font-display text-outline text-4xl">Hall of Shame</h2>
      <ol className="mt-6 flex-1 space-y-1 overflow-y-auto text-sm">
        {board.slice(0, 30).map((p, i) => (
          <li key={p.a} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${p.a === me ? 'bg-offwhite text-ink' : ''}`}>
            <span className="w-6 text-right tabular-nums opacity-60">{MEDAL[i] ?? i + 1}</span>
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

function NameForm({ initial, placeholder, onSubmit, onCancel }) {
  const [name, setName] = useState(initial)
  const submit = () => onSubmit(name.trim() || placeholder)
  return (
    <Center>
      <Brainrot stage={1} outline={3} className="bob mb-4 h-28 w-28" />
      <h1 className="font-display text-outline text-4xl leading-none">Ton pseudo</h1>
      <p className="mt-3 text-sm opacity-70">C'est lui qui s'affiche sur l'écran géant</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        maxLength={NAME_MAX}
        autoFocus
        className="mt-8 w-64 rounded-2xl bg-offwhite/10 p-3 text-center text-xl font-bold outline-none placeholder:opacity-30"
        placeholder={placeholder}
      />
      <button className="btn-chunky mt-4 bg-neon px-10 py-3 text-base font-bold text-ink" onPointerDown={submit}>C'est parti</button>
      {onCancel && <button className="mt-4 text-sm opacity-60" onPointerDown={onCancel}>Annuler</button>}
    </Center>
  )
}

function RoomForm({ onSubmit }) {
  const [code, setCode] = useState('')
  return (
    <Center>
      <Brainrot stage={5} outline={3} className="bob mb-4 h-32 w-32" />
      <h1 className="font-display text-outline text-5xl leading-none">Aura Farm<br />Battle</h1>
      <p className="mt-3 text-sm opacity-70">Entre le code affiché sur l'écran géant</p>
      <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" className="mt-8 w-44 rounded-2xl bg-offwhite/10 p-3 text-center text-2xl font-bold uppercase tracking-widest outline-none placeholder:opacity-30" placeholder="CODE" />
      <button className="btn-chunky mt-4 bg-neon px-10 py-3 text-base font-bold text-ink" onPointerDown={() => code && onSubmit(code)}>Rejoindre</button>
      <a className="mt-12 text-xs underline decoration-offwhite/40 underline-offset-4 opacity-70" href="/screen">Tu animes la partie ? Écran géant et régie</a>
    </Center>
  )
}
