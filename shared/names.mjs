// Pseudo déterministe dérivé de l'adresse : identique sur tous les écrans, zéro stockage
// on-chain, zéro modération à faire pendant la démo.
const FIRST = [
  'Skibidi', 'Sigma', 'Rizzler', 'Gyatt', 'Tralalero', 'Bombardino', 'Cappuccino', 'Brr Brr',
  'Tung Tung', 'Lirili', 'Chimpanzini', 'Frulli', 'Boneca', 'Trippi', 'Bobrito', 'Giga',
]
const LAST = [
  'Carbonara', 'Coccodrillo', 'Assassino', 'Patapim', 'Sahur', 'Larila', 'Bananini', 'Frulla',
  'Ambalabu', 'Troppi', 'Bandito', 'Nonna', 'Vespa', 'Mozzarella', 'Tiramisù', 'Gorgonzola',
]

export function nameOf(address) {
  const a = address.toLowerCase().replace('0x', '')
  const first = FIRST[parseInt(a.slice(0, 2), 16) % FIRST.length]
  const last = LAST[parseInt(a.slice(2, 4), 16) % LAST.length]
  return `${first} ${last} #${a.slice(-3).toUpperCase()}`
}

// Pseudo choisi par le joueur (optionnel, sinon nameOf). Stocké par le serveur, pas on-chain.
export const NAME_MAX = 18
/** Nettoie un pseudo saisi : pas de caractères de contrôle, espaces normalisés, longueur bornée. '' si vide. */
export const cleanName = (raw) =>
  String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
/** Message signé par le wallet jetable : prouve au serveur que le pseudo vient bien de ce joueur. */
export const nameMessage = (name) => `Aura Farm Battle - mon pseudo : ${name}`
