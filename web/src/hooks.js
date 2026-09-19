import { useSyncExternalStore } from 'react'

/** Abonne un composant à un store de game.js (le "snapshot" est un simple numéro de version). */
export function useStore(store) {
  useSyncExternalStore(store.subscribe, () => store.version)
  return store.state
}

// Petit synthé Web Audio : aucun fichier son à charger, latence nulle. À remplacer par vos mèmes.
let ctx
export function blip(freq = 440, dur = 0.06, type = 'square') {
  try {
    ctx ??= new (window.AudioContext ?? window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume() // iOS : débloqué par le premier toucher
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.setValueAtTime(0.08, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + dur)
  } catch {}
}
export const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.18, 'sawtooth'), i * 90))

export const SPRITES = ['👶', '🛵', '👵', '🍝'] // placeholders : un sprite par palier (voir STAGES)
export const SHOUTS = ['MAMA MIA!', 'SIGMA RIZZ', 'SKIBIDI!', '+AURA', 'GYATT', 'BOMBARDIRO!', 'NO CAP']
