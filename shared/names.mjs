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
