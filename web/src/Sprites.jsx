import { STAGES } from '../../shared/config.mjs'
import Brainrot from './Brainrot.jsx'

export default function Sprites() {
  return (
    <div className="bg-tricolore min-h-full p-6">
      <h1 className="font-display text-stroke text-4xl text-neon">LES BRAINROTS</h1>
      <p className="mt-1 text-sm opacity-70">Pour remplacer un dessin : web/public/sprites/&lt;slug&gt;.png</p>
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
        {STAGES.map((s, i) => (
          <figure key={s.slug} className="rounded-2xl bg-black/50 p-3 text-center">
            <Brainrot stage={i} outline={4} className="mx-auto h-48 w-48" />
            <figcaption className="font-display text-xl">{i + 1}. {s.name}</figcaption>
            <p className="text-xs opacity-60">{s.slug} · dès {String(s.min)} aura</p>
            <div className="mt-2 flex items-center justify-center gap-2"><Brainrot stage={i} outline={1} className="h-10 w-10" /><Brainrot stage={i} outline={1} className="h-8 w-8" /></div>
          </figure>
        ))}
      </div>
    </div>
  )
}
