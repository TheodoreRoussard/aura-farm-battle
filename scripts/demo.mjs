// Lance toute la démo en local avec UNE commande (aucun MON nécessaire) :
//   chaîne Monad locale (anvil) → déploiement → serveur → front Vite.
//
//   pnpm demo                 puis ouvre les URLs affichées
//   pnpm demo -- --bots 20    ajoute 20 joueurs simulés qui jouent un round de 30 s
//
// Ctrl+C arrête tout proprement.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { arg, ROOT, sleep } from './lib.mjs'

const RPC = 'http://127.0.0.1:8545'
const TOKEN = process.env.ADMIN_TOKEN ?? 'dev'
const ROOM = process.env.ROOM_CODE ?? 'AURA'
const BOTS = Number(arg('bots', 0))
const children = []

const bin = (name) => {
  const local = path.join(os.homedir(), '.foundry/bin', name)
  return fs.existsSync(local) ? local : name // Foundry n'est pas toujours dans le PATH du shell
}

function run(label, cmd, args, { env = {}, cwd = ROOT, quiet = false } = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  const print = (buf) => {
    if (quiet) return
    for (const line of String(buf).split('\n')) if (line.trim()) console.log(`[${label}] ${line}`)
  }
  child.stdout.on('data', print)
  child.stderr.on('data', print)
  child.on('exit', (code) => code && console.log(`[${label}] arrêté (code ${code})`))
  return child
}

const once = (label, cmd, args, opts) =>
  new Promise((resolve, reject) => run(label, cmd, args, opts).on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${label} a échoué`)))))

async function rpcUp() {
  try {
    const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' })
    return res.ok
  } catch {
    return false
  }
}

const shutdown = () => {
  for (const c of children) c.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

if (await rpcUp()) {
  console.error(`Un nœud tourne déjà sur ${RPC} : arrête-le d'abord (ou une autre instance de la démo).`)
  process.exit(1)
}

console.log('1/4 chaîne Monad locale (anvil, blocs de 0,3 s)...')
run('anvil', bin('anvil'), ['--network', 'monad', '--block-time', '0.3', '--host', '0.0.0.0'], { quiet: true })
for (let i = 0; i < 50 && !(await rpcUp()); i++) await sleep(200)
if (!(await rpcUp())) throw new Error("anvil n'a pas démarré (Foundry >= 1.8 installé ?)")

console.log('2/4 compilation + déploiement du contrat...')
if (!fs.existsSync(path.join(ROOT, 'contracts/out/AuraFarm.sol/AuraFarm.json'))) {
  await once('forge', bin('forge'), ['build', '--offline'], { cwd: path.join(ROOT, 'contracts') })
}
await once('deploy', process.execPath, ['scripts/deploy.mjs', '--local'])

console.log('3/4 serveur (dotation, classement, régie)...')
run('server', process.execPath, ['server/index.mjs'], { env: { NETWORK: 'local', ADMIN_TOKEN: TOKEN, ROOM_CODE: ROOM } })

console.log('4/4 front...')
// Les variables VITE_* du processus passent devant les fichiers .env : la démo force le réseau local.
// Vite lancé via node (pas `pnpm dev`) : fonctionne même si pnpm n'est pas dans le PATH (Windows).
run('web', process.execPath, ['node_modules/vite/bin/vite.js', '--host', '--port', '5173', '--strictPort'], { cwd: path.join(ROOT, 'web'), env: { VITE_NETWORK: 'local' }, quiet: true })
await sleep(2500)

// IP à donner aux téléphones : on écarte les cartes virtuelles (Hyper-V, WSL, VMware, Docker...).
const VIRTUAL = /vEthernet|VMware|VirtualBox|WSL|Hyper-V|Docker|Loopback|vbox|br-|docker|veth/i
const lan = Object.entries(os.networkInterfaces())
  .filter(([name]) => !VIRTUAL.test(name))
  .flatMap(([, list]) => list)
  .find((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))?.address
console.log(`
────────────────────────────────────────────────────────────────────
  Écran géant : http://localhost:5173/screen?room=${ROOM}&token=${TOKEN}
  Joueur      : http://localhost:5173/?room=${ROOM}
  Téléphone   : http://${lan ?? '<ip-du-laptop>'}:5173/?room=${ROOM}   (même WiFi que ce laptop)

  Lance un round avec le bouton START de l'écran géant, puis tape sur le personnage.
  Bots        : pnpm load -- --local --players 20 --seconds 30   (démarre son propre round)
────────────────────────────────────────────────────────────────────
`)

if (BOTS > 0) {
  await sleep(1500)
  console.log(`Round de démonstration avec ${BOTS} bots...`)
  run('bots', process.execPath, ['scripts/load.mjs', '--local', '--players', String(BOTS), '--seconds', '30'], { quiet: true })
}
