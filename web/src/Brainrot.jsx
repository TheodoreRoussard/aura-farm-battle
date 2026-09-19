// Les personnages du jeu : un brainrot italien par palier d'évolution (voir STAGES dans shared/config.mjs).
//
// Chaque personnage est dessiné en SVG (aucun fichier à charger, net à toutes les tailles).
// Pour utiliser une VRAIE image à la place : dépose `web/public/sprites/<slug>.png`
// (ex. tralalero-tralala.png) — elle remplace automatiquement le dessin, sans toucher au code.
import { useSyncExternalStore } from 'react'
import { STAGES } from '../../shared/config.mjs'

const INK = '#111'
const line = { stroke: INK, strokeWidth: 5, strokeLinejoin: 'round', strokeLinecap: 'round' }
const thin = { ...line, strokeWidth: 3 }
const Eye = ({ x, y, r = 7 }) => (
  <>
    <circle cx={x} cy={y} r={r} fill="#fff" {...thin} />
    <circle cx={x + r * 0.2} cy={y + r * 0.1} r={r * 0.45} fill={INK} />
  </>
)
/** Membre "fil de fer" avec contour : un trait noir épais sous un trait de couleur. */
const Limb = ({ d, color, w = 7 }) => (
  <>
    <path d={d} fill="none" stroke={INK} strokeWidth={w + 5} strokeLinecap="round" />
    <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" />
  </>
)

const ART = {
  // Un chimpanzé dans une banane
  'chimpanzini-bananini': (
    <>
      <path d="M70 74 Q38 88 32 124 Q56 106 78 102 Z" fill="#ffe98a" {...line} />
      <path d="M120 74 Q154 86 162 120 Q138 104 114 102 Z" fill="#ffe98a" {...line} />
      <path d="M70 72 Q44 132 96 184 Q120 192 134 178 Q104 140 120 72 Z" fill="#ffd93b" {...line} />
      <path d="M100 182 Q116 190 132 178" fill="none" stroke="#6a8f2a" strokeWidth="7" strokeLinecap="round" />
      <circle cx="63" cy="56" r="11" fill="#6b4226" {...line} />
      <circle cx="127" cy="56" r="11" fill="#6b4226" {...line} />
      <circle cx="63" cy="56" r="5" fill="#e0b48c" />
      <circle cx="127" cy="56" r="5" fill="#e0b48c" />
      <circle cx="95" cy="56" r="31" fill="#6b4226" {...line} />
      <ellipse cx="95" cy="66" rx="21" ry="17" fill="#e0b48c" {...thin} />
      <Eye x={85} y={50} r={6} />
      <Eye x={105} y={50} r={6} />
      <path d="M84 70 Q95 80 106 70" fill="none" {...thin} />
      <circle cx="92" cy="62" r="1.6" fill={INK} />
      <circle cx="98" cy="62" r="1.6" fill={INK} />
    </>
  ),

  // Une ballerine à tête de tasse de cappuccino
  'ballerina-cappuccina': (
    <>
      <Limb d="M92 140 L84 182" color="#f2c9a0" />
      <Limb d="M108 140 L122 178" color="#f2c9a0" />
      <ellipse cx="82" cy="186" rx="9" ry="5" fill="#ff7eb6" {...thin} />
      <ellipse cx="125" cy="182" rx="9" ry="5" fill="#ff7eb6" {...thin} />
      <Limb d="M88 106 Q58 112 38 88" color="#f2c9a0" />
      <Limb d="M112 106 Q142 112 162 88" color="#f2c9a0" />
      <path d="M100 86 V100" {...line} />
      <path d="M86 98 H114 L110 124 H90 Z" fill="#ff5fa2" {...line} />
      <path d="M46 130 Q60 112 100 114 Q140 112 154 130 Q146 146 128 140 Q114 150 100 142 Q86 150 72 140 Q54 146 46 130 Z" fill="#ffb3d4" {...line} />
      <path d="M134 42 Q160 46 152 66 Q146 76 128 72" fill="none" stroke={INK} strokeWidth="12" strokeLinecap="round" />
      <path d="M134 42 Q160 46 152 66 Q146 76 128 72" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <path d="M64 30 H136 L126 80 Q100 92 74 80 Z" fill="#fff" {...line} />
      <ellipse cx="100" cy="30" rx="36" ry="10" fill="#7b4a2b" {...line} />
      <path d="M86 30 Q94 24 100 30 Q106 24 114 30 Q100 38 86 30 Z" fill="#f3e2c7" />
      <path d="M80 54 q7 -8 14 0 M106 54 q7 -8 14 0" fill="none" {...thin} />
      <path d="M78 50 l-4 -5 M84 46 l-1 -6 M122 50 l4 -5 M116 46 l1 -6" {...thin} />
      <ellipse cx="100" cy="68" rx="5" ry="3.5" fill="#e0245e" />
      <circle cx="80" cy="64" r="4" fill="#ffb3d4" />
      <circle cx="120" cy="64" r="4" fill="#ffb3d4" />
    </>
  ),

  // Un éléphant-cactus en sandales
  'lirili-larila': (
    <>
      <rect x="52" y="140" width="24" height="36" rx="8" fill="#43a047" {...line} />
      <rect x="104" y="140" width="24" height="36" rx="8" fill="#43a047" {...line} />
      <path d="M44 176 H82 Q86 186 78 188 H46 Q40 184 44 176 Z" fill="#8d5a2b" {...line} />
      <path d="M96 176 H134 Q138 186 130 188 H98 Q92 184 96 176 Z" fill="#8d5a2b" {...line} />
      <path d="M52 176 Q64 164 76 176 M104 176 Q116 164 128 176" fill="none" stroke="#e53935" strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="90" cy="116" rx="56" ry="42" fill="#4caf50" {...line} />
      <path d="M36 110 Q22 116 26 134" fill="none" {...line} />
      <ellipse cx="118" cy="74" rx="22" ry="30" fill="#2e7d32" {...line} />
      <circle cx="144" cy="78" r="33" fill="#4caf50" {...line} />
      <path d="M166 92 Q192 112 176 146 Q170 158 160 148 Q172 124 150 106 Z" fill="#4caf50" {...line} />
      <path d="M150 104 Q146 118 136 120" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <Eye x={152} y={68} r={7} />
      <path d="M136 50 q-4 -14 6 -18 q2 8 10 6 q-2 10 -16 12 Z" fill="#ff5fa2" {...thin} />
      <path
        d="M58 96 l-7 -7 M78 84 l-3 -9 M100 82 l2 -9 M64 124 l-9 3 M86 112 l-2 -9 M108 120 l7 -6 M72 146 l-7 5 M104 146 l5 7 M130 56 l-6 -7 M160 52 l5 -8 M170 80 l9 -2 M126 96 l-8 4"
        fill="none"
        stroke="#1b5e20"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </>
  ),

  // Un rondin de bois armé d'une batte
  'tung-tung-tung-sahur': (
    <>
      <Limb d="M88 140 L82 178" color="#c4945a" />
      <Limb d="M112 140 L120 178" color="#c4945a" />
      <ellipse cx="78" cy="182" rx="12" ry="6" fill="#a87c45" {...thin} />
      <ellipse cx="124" cy="182" rx="12" ry="6" fill="#a87c45" {...thin} />
      <Limb d="M70 98 Q48 108 42 130" color="#c4945a" />
      <path d="M150 84 L176 18 Q186 12 192 22 L162 90 Z" fill="#8b5a2b" {...line} />
      <path d="M170 40 l12 5 M164 56 l11 5" {...thin} />
      <Limb d="M130 96 Q148 100 156 84" color="#c4945a" />
      <rect x="68" y="22" width="64" height="122" rx="30" fill="#d2a36b" {...line} />
      <ellipse cx="100" cy="34" rx="22" ry="7" fill="#e6c08c" {...thin} />
      <path d="M78 108 q6 10 0 24 M100 112 q5 12 -1 24 M122 106 q-6 12 0 26" fill="none" stroke="#a87c45" strokeWidth="3" strokeLinecap="round" />
      <Eye x={87} y={66} r={12} />
      <Eye x={114} y={66} r={12} />
      <path d="M76 50 l18 5 M126 50 l-18 5" {...line} />
      <path d="M90 94 H112" {...line} />
    </>
  ),

  // Un bombardier à tête de crocodile
  'bombardiro-crocodilo': (
    <>
      <path d="M40 96 L14 58 Q30 60 58 86 Z" fill="#6f7f5c" {...line} />
      <path d="M30 104 L8 112 L34 116 Z" fill="#6f7f5c" {...line} />
      <path d="M26 100 Q60 72 132 76 L168 84 L168 116 Q120 128 60 122 Q34 116 26 100 Z" fill="#7f9168" {...line} />
      <circle cx="78" cy="100" r="11" fill="#fff" {...thin} />
      <circle cx="78" cy="100" r="6.5" fill="#e53935" />
      <circle cx="78" cy="100" r="3" fill="#2e7d32" />
      <path d="M104 78 Q118 60 138 78 Z" fill="#9fd8ff" {...line} />
      <path d="M150 80 L198 90 Q200 100 198 104 L150 120 Z" fill="#4f9a3f" {...line} />
      <path d="M152 102 H196" {...thin} />
      <path d="M158 102 l4 7 l4 -7 l4 7 l4 -7 l4 7 l4 -7 l4 7 l4 -7 l4 6" fill="#fff" {...thin} />
      <circle cx="156" cy="78" r="10" fill="#4f9a3f" {...line} />
      <Eye x={157} y={77} r={6} />
      <circle cx="192" cy="90" r="2" fill={INK} />
      <path d="M84 110 L58 160 L112 160 L126 112 Z" fill="#96a0a8" {...line} />
      <ellipse cx="100" cy="142" rx="17" ry="9" fill="#5f6a72" {...line} />
      <ellipse cx="120" cy="142" rx="3.5" ry="21" fill="#e8eef2" opacity="0.9" {...thin} />
      <g transform="rotate(20 140 168)">
        <ellipse cx="140" cy="168" rx="14" ry="7" fill="#4a4a4a" {...thin} />
        <path d="M126 168 l-9 -7 v14 Z" fill="#e53935" {...thin} />
      </g>
      <g transform="rotate(20 168 150)">
        <ellipse cx="168" cy="150" rx="12" ry="6" fill="#4a4a4a" {...thin} />
        <path d="M156 150 l-8 -6 v12 Z" fill="#e53935" {...thin} />
      </g>
    </>
  ),

  // Le requin à trois pattes en baskets
  'tralalero-tralala': (
    <>
      {[78, 108, 138].map((x, i) => (
        <g key={x} transform={`rotate(${[8, 0, -8][i]} ${x} 130)`}>
          <rect x={x - 7} y="124" width="14" height="40" rx="6" fill="#5b8fd6" {...line} />
          <path d={`M${x - 10} 162 h20 q14 2 16 12 v6 h-36 Z`} fill="#2f6fe0" {...line} />
          <path d={`M${x - 10} 176 h36`} stroke="#fff" strokeWidth="5" strokeLinecap="round" />
          <path d={`M${x - 2} 166 l10 6`} stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
        </g>
      ))}
      <path d="M50 98 L14 64 Q30 98 12 132 Z" fill="#5b8fd6" {...line} />
      <path d="M100 62 L118 22 Q136 46 142 66 Z" fill="#5b8fd6" {...line} />
      <path d="M44 100 Q70 54 130 60 Q178 66 192 98 Q172 130 120 134 Q70 136 44 100 Z" fill="#5b8fd6" {...line} />
      <path d="M62 112 Q112 142 188 100 Q170 130 120 134 Q82 135 62 112 Z" fill="#f4f7fb" {...thin} />
      <path d="M112 120 L96 152 L134 130 Z" fill="#4a7bc0" {...line} />
      <path d="M126 82 q-5 9 0 18 M136 82 q-5 9 0 18 M146 84 q-5 8 0 16" fill="none" {...thin} />
      <Eye x={164} y={84} r={7} />
      <path d="M150 112 Q172 114 188 100" fill="none" {...line} />
      <path d="M156 112 l4 7 l4 -7 l4 6 l4 -7 l4 6 l4 -8" fill="#fff" {...thin} />
    </>
  ),
}

// ── Remplacement par une image : on teste une fois, au chargement, quels PNG existent ──
const overrides = new Map() // slug → true si /sprites/<slug>.png est une image valide
const listeners = new Set()
let version = 0
for (const { slug } of STAGES) {
  const img = new Image()
  img.onload = () => {
    overrides.set(slug, true)
    version++
    listeners.forEach((fn) => fn())
  }
  img.src = `/sprites/${slug}.png`
}
const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn))

// Contour blanc "sticker" : 4 ombres portées nettes, une par direction (les traits noirs
// disparaîtraient sinon sur le fond sombre).
const sticker = (px) => ({ filter: [[px, 0], [-px, 0], [0, px], [0, -px]].map(([x, y]) => `drop-shadow(${x}px ${y}px 0 #fff)`).join(' ') })

/**
 * Le personnage du palier `stage` (0 → STAGES.length - 1). Se dimensionne via className (h-… w-…).
 * `outline` = épaisseur du contour blanc en px (0 pour le désactiver).
 */
export default function Brainrot({ stage, className = '', outline = 2 }) {
  useSyncExternalStore(subscribe, () => version)
  const { slug, name } = STAGES[Math.min(stage, STAGES.length - 1)]
  const style = outline ? sticker(outline) : undefined
  if (overrides.get(slug)) return <img src={`/sprites/${slug}.png`} alt={name} draggable={false} style={style} className={`object-contain ${className}`} />
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={name} style={style} className={`overflow-visible ${className}`}>
      {ART[slug]}
    </svg>
  )
}
