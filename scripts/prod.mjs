// Met le jeu en PRODUCTION (testnet) depuis ce laptop avec UNE commande :
//   serveur (dotation, classement, régie) → tunnel HTTPS cloudflared → URL inscrite dans Vercel → front redéployé.
//
//   pnpm prod                  tout, y compris le redéploiement Vercel (~20 s)
//   pnpm prod -- --no-deploy   serveur + tunnel seulement (pour tester sans toucher à la prod)
//
// Pourquoi un tunnel : le serveur garde des WebSockets ouverts, ce que Vercel (serverless) ne sait pas faire,
// et la page Vercel est en HTTPS, donc le navigateur exige une URL serveur en https:// ("mixed content").
// Pourquoi ce laptop : la clé admin (celle qui détient les MON) ne quitte jamais cette machine.
// L'URL d'un tunnel rapide change à CHAQUE lancement et les VITE_* sont figées au build : d'où le redéploiement.
// Garde le laptop éveillé et ce terminal ouvert pendant toute la partie. Ctrl+C arrête tout proprement.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, sleep } from './lib.mjs' // charge aussi .env (dotenv)

const PORT = Number(process.env.PORT ?? 8787)
const ROOM = process.env.ROOM_CODE ?? 'AURA'
const TOKEN = process.env.ADMIN_TOKEN ?? 'change-moi'
const FRONT = process.env.FRONT_URL ?? 'https://aura-farm-battle.vercel.app'
const DEPLOY = !process.argv.includes('--no-deploy')
const children = []
let stopping = false // vrai pendant l'arrêt : le serveur ne doit plus être relancé

function run(label, cmd, args, { onLine, quiet = false } = {}) {
  const child = spawn(cmd, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  const read = (buf) => {
    for (const line of String(buf).split('\n')) {
      if (!line.trim()) continue
      onLine?.(line)
      if (!quiet) console.log(`[${label}] ${line}`)
    }
  }
  child.stdout.on('data', read)
  child.stderr.on('data', read)
  child.on('error', (e) => fail(`${label} : ${e.code === 'ENOENT' ? `commande "${cmd}" introuvable` : e.message}`))
  child.on('exit', (code) => code && console.log(`[${label}] arrêté (code ${code})`))
  return child
}

// Commande ponctuelle ; `input` est envoyé sur stdin (la valeur d'une variable Vercel ne passe pas en argument).
const once = (label, cmd, args, { input, tolerate = false } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (b) => (out += b))
    child.stderr.on('data', (b) => (out += b))
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 || tolerate ? resolve(out) : reject(new Error(`${label} a échoué :\n${out.split('\n').slice(-8).join('\n')}`))))
    child.stdin.end(input ?? '')
  })

const healthy = async (base) => {
  try {
    return (await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) })).ok
  } catch {
    return false
  }
}

const shutdown = () => {
  stopping = true
  for (const c of children) c.kill('SIGTERM')
  process.exit(0)
}
function fail(message) {
  console.error(`\n✗ ${message}`)
  stopping = true
  for (const c of children) c.kill('SIGTERM')
  process.exit(1)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// ───────────────────────────────── Vérifications avant de lancer quoi que ce soit ─────────────────────────────────
if (!process.env.ADMIN_PRIVATE_KEY?.startsWith('0x') || process.env.ADMIN_PRIVATE_KEY.length !== 66) fail('ADMIN_PRIVATE_KEY absente de .env')
if (TOKEN === 'change-moi') fail("ADMIN_TOKEN vaut encore \"change-moi\" : n'importe qui pourrait lancer un round")
if (!fs.existsSync(path.join(ROOT, 'deployments/10143.json'))) fail('Contrat pas encore déployé sur le testnet : lance `pnpm deploy:testnet`')
if (await healthy(`http://localhost:${PORT}`)) fail(`Un serveur tourne déjà sur le port ${PORT} (la démo locale ?) : arrête-le d'abord`)

// macOS : empêche la mise en veille tant que ce script tourne (fermer le capot met quand même en veille).
if (process.platform === 'darwin') run('caffeinate', 'caffeinate', ['-dims', '-w', String(process.pid)], { quiet: true })

console.log('1/3 serveur (testnet)...')
// Le serveur est relancé tout seul s'il s'arrête (plantage, `pkill -f server/index.mjs` après une mise à jour du
// code) : le tunnel pointe sur le port, pas sur le processus, donc l'URL publique ne change pas.
const startServer = () =>
  run('server', process.execPath, ['server/index.mjs']).on('exit', () => {
    if (stopping) return
    console.log('[server] arrêté : relance dans 1 s...')
    setTimeout(startServer, 1000)
  })
startServer()
for (let i = 0; i < 60 && !(await healthy(`http://localhost:${PORT}`)); i++) await sleep(500)
if (!(await healthy(`http://localhost:${PORT}`))) fail("Le serveur n'a pas démarré (voir les lignes [server] ci-dessus)")

console.log('2/3 tunnel HTTPS (cloudflared)...')
let tunnel = null
let registered = false
// --protocol http2 : par défaut cloudflared passe par QUIC (UDP), que beaucoup de réseaux (écoles, salles
// d'événement) bloquent ; HTTP/2 passe par le port TCP 443, ouvert partout.
run('tunnel', 'cloudflared', ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://localhost:${PORT}`], {
  quiet: true,
  onLine: (line) => {
    tunnel ??= line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null
    if (line.includes('Registered tunnel connection')) registered = true
  },
})
// On n'interroge l'URL qu'une fois le tunnel enregistré : une requête trop précoce fait mémoriser
// "domaine inexistant" au résolveur DNS de la machine pendant de longues secondes.
for (let i = 0; i < 90 && !(tunnel && registered); i++) await sleep(500)
if (!tunnel || !registered) fail("cloudflared n'a pas ouvert de tunnel (installé ? `brew install cloudflared` — réseau ?)")
await sleep(3000)
// Le nom de domaine du tunnel met quelques secondes à se propager : on attend qu'il réponde vraiment.
for (let i = 0; i < 40 && !(await healthy(tunnel)); i++) await sleep(1500)
if (!(await healthy(tunnel))) fail(`Le tunnel ${tunnel} ne répond pas`)
console.log(`      ${tunnel}`)

if (DEPLOY) {
  console.log('3/3 Vercel : VITE_SERVER_URL + redéploiement du front...')
  await once('vercel env rm', 'vercel', ['env', 'rm', 'VITE_SERVER_URL', 'production', '--yes'], { tolerate: true }) // absente au 1er lancement
  await once('vercel env add', 'vercel', ['env', 'add', 'VITE_SERVER_URL', 'production'], { input: tunnel })
  await once('vercel deploy', 'vercel', ['--prod', '--yes'])
} else console.log('3/3 Vercel : ignoré (--no-deploy) — le front en ligne ne connaît PAS ce tunnel')

console.log(`
────────────────────────────────────────────────────────────────────
  Écran géant (régie) : ${FRONT}/screen?room=${ROOM}&token=${TOKEN}
                        (ou ${FRONT}/screen puis le code régie : ${TOKEN})
  Joueurs             : ${FRONT}/?room=${ROOM}   (QR code de l'écran géant)
  Serveur             : ${tunnel}/health

  Ne ferme pas ce terminal, ne laisse pas le laptop se mettre en veille.
  Si le tunnel tombe : Ctrl+C puis \`pnpm prod\` (nouvelle URL → redéploiement → les joueurs rechargent la page).
────────────────────────────────────────────────────────────────────
`)
