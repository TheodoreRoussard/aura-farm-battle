// Frise de blocs du joueur : "où sont passés mes taps ?"
// Chaque case est un bloc Monad (0,3 s). Les cases qui contiennent MES taps affichent "+N" et
// s'affirment quand le bloc avance dans le consensus : proposé (contour) → voté → finalisé (plein).
import { blockState } from './game.js'

const SLOTS = 10

const LOOK = {
  // [bloc quelconque, bloc contenant mes taps]
  proposed: ['border border-dashed border-offwhite/25', 'border border-dashed border-neon text-neon'],
  voted: ['bg-offwhite/10', 'bg-neon/55 text-ink'],
  finalized: ['bg-offwhite/20', 'bg-neon text-ink'],
}

export default function BlockTrail({ live, me, inFlight }) {
  const { head } = live
  const slots = Array.from({ length: SLOTS }, (_, i) => head - SLOTS + 1 + i)
  const now = Date.now()
  const last = [...me.myTxs].reverse().find((t) => t.finalMs !== null) ?? me.myTxs.at(-1)

  return (
    <section>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 overflow-hidden">
          {/* key={head} : la rangée est recréée à chaque bloc et glisse d'une case (voir .conveyor) */}
          <div key={head} className="conveyor flex gap-1.5" style={{ '--slot': `calc(100% / ${SLOTS})` }}>
            {slots.map((n) => {
              const mine = me.myBlocks.get(n)
              return (
                <div
                  key={n}
                  className={`flex h-7 min-w-0 flex-1 items-center justify-center rounded-md text-[11px] font-bold tabular-nums ${LOOK[blockState(live, n)]?.[mine ? 1 : 0] ?? ''} ${mine && now - mine.at < 320 ? 'block-in' : ''}`}
                >
                  {mine ? `+${mine.count}` : ''}
                </div>
              )
            })}
          </div>
        </div>
        {/* Taps pas encore inclus dans un bloc (en file + transactions en vol) */}
        <div className={`flex h-7 w-10 shrink-0 items-center justify-center rounded-md border border-dashed text-[11px] font-bold tabular-nums ${inFlight ? 'border-neon text-neon' : 'border-offwhite/20 text-transparent'}`}>
          +{inFlight}
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] tabular-nums opacity-60">
        {last
          ? `+${last.count} dans le bloc ${last.block.toLocaleString('fr-FR')} · vu en ${last.seenMs ?? '?'} ms${last.finalMs !== null ? ` · finalisé en ${last.finalMs} ms` : ''}`
          : 'Chaque case est un bloc de 0,3 s : tes taps y apparaissent.'}
      </p>
    </section>
  )
}
