# Aura Farm Battle — Monad Blitz

Clicker "brainrot italien" où chaque envoi de taps est une vraie transaction Monad, avec un écran
géant qui montre le classement et le débit en direct.

```
Téléphones (web/)  ── tx signées en local ──▶  RPC Monad testnet  ──▶  contracts/AuraFarm.sol
      ▲                                                                       │ events
      └── WebSocket : classement, bloc courant ──  server/  ◀── monadLogs ────┘
                                                   (dotation MON · indexeur · régie)
Écran géant (web/ → /screen) ◀─────────────────────┘
```

| Dossier | Rôle |
|---|---|
| `contracts/` | `AuraFarm.sol` (le jeu) + `AuraDrip.sol` (distributeur de MON) + tests Foundry (`network = "monad"` → barème de gas Monad / MIP-8) |
| `shared/` | code commun front / serveur / scripts : config + ABI, `TxPump` (nonces locaux), `openFeed` (monadLogs) |
| `scripts/` | `deploy`, `gas` (mesure), `load` (test de charge), `round` (régie en CLI), `drip` (solde / recharge du distributeur), `prod` (mise en prod) |
| `server/` | dotation de MON, classement en mémoire, lancement des rounds |
| `web/` | Vite + React + Tailwind : `/` = téléphone, `/screen` = écran géant |

## Démarrer en local (aucun MON nécessaire)

```sh
pnpm install
pnpm demo            # lance tout d'un coup (chaîne locale, contrat, serveur, front) — détail ci-dessous

# ... ou étape par étape :
cd contracts && forge build && cd ..                        # forge-std est versionné dans contracts/lib
anvil --network monad --block-time 0.3 --host 0.0.0.0      # terminal 1 : Monad local, blocs de 0,3 s
pnpm deploy:local                                           # terminal 2
NETWORK=local ADMIN_TOKEN=dev pnpm server                   # terminal 2
cd web && pnpm dev                                          # terminal 3
```

- Téléphone : `http://<ip-du-laptop>:5173/?room=AURA` — écran : `http://localhost:5173/screen?room=AURA&token=dev`
- Simuler une salle : `pnpm load -- --local --players 25 --seconds 25`

## Passer sur le testnet

État au 2026-09-19 : **déployé et validé sur le testnet** — AuraFarm `0x066b11d6732812d92338b89ed5fdd3db42f8a1f5`,
AuraDrip `0x29d00269588c49353cf57e4e18d03983db1a2d6a` (`deployments/10143.json`), admin `0x538fECF0D180cBd97752F4b51b5BdEbC023119Bb`.
Pour repartir de zéro :

1. `cast wallet new` → mets la clé dans `.env` (`ADMIN_PRIVATE_KEY`), envoie-lui tes MON du faucet.
2. `pnpm deploy:testnet` : déploie AuraFarm puis AuraDrip, et verse dans le distributeur `DRIP_BUDGET_MON` (plafonné au
   solde moins 0,6 MON gardés pour le gas). `-- --drip-only` ne redéploie que le distributeur ; `-- --farm-only` ne redéploie que le jeu (nouvelle version du contrat) et garde le distributeur et ses MON. Puis lance les commandes
   `forge verify-contract ...` affichées (Sourcify, sans clé API).
3. **Go / no-go** : `pnpm load -- --players 3 --seconds 6` (≈ 0,35 MON). À lire dans le bilan : 0 tx abandonnée,
   0 revert, taps envoyés = taps on-chain. Résultat du 2026-09-19 : 60/60 tx, vu en 313 ms, finalisé en 850 ms (p50).
   `pnpm drip` affiche les soldes ; `pnpm drip -- fund 2` recharge le distributeur ; `pnpm drip -- withdraw` rapatrie tout.
   On peut aussi envoyer des MON du faucet directement à l'adresse du distributeur : le serveur relit son solde toutes les 5 s.
4. **`pnpm prod`** : lance le serveur, ouvre un tunnel HTTPS `cloudflared` vers lui, inscrit l'URL du tunnel dans
   Vercel (`VITE_SERVER_URL`) et redéploie le front (~20 s), puis affiche l'URL de l'écran géant avec son token.
   Prérequis : `brew install cloudflared`. Le serveur tourne sur le laptop parce que la clé admin (les MON) ne doit
   pas quitter la machine et que Vercel ne sait pas garder de WebSocket ouvert. L'URL d'un tunnel rapide change à
   chaque lancement : relancer `pnpm prod` redéploie le front tout seul. `pnpm prod -- --no-deploy` = sans Vercel.
   **Lancer une partie** : ouvre https://aura-farm-battle.vercel.app/screen (lien « Écran géant » depuis la page joueur),
   tape le code régie (`ADMIN_TOKEN` du `.env`, affiché aussi par `pnpm prod`) → QR code + bouton « Lancer un round ».
   Le code est gardé dans le navigateur et n'apparaît jamais dans l'URL projetée.
5. Front sur Vercel : projet `aura-farm-battle` → https://aura-farm-battle.vercel.app (chaque push sur `main` redéploie).
   Le projet est lié à la RACINE du dépôt (pas à `web/`) parce que `web/` importe `../shared/`, qui importe `viem`
   installé à la racine ; tout le réglage est dans `vercel.json` (build `pnpm -C web build`, sortie `web/dist`,
   réécriture de toutes les routes vers `index.html` pour que `/screen` et `/sprites` ne fassent pas 404).
   Variables : `VITE_NETWORK=testnet` (déjà posée) et `VITE_SERVER_URL` (posée par `pnpm prod` à chaque lancement ;
   à la main : `printf 'https://mon-serveur' | vercel env add VITE_SERVER_URL production && vercel --prod`).
   Les `VITE_*` sont figées AU BUILD : changer une variable sans redéployer ne change rien.
   L'URL du serveur doit être en `https://` (donc `wss://`) : la page Vercel est en HTTPS et le navigateur
   bloque tout appel `http://` / `ws://` depuis une page HTTPS ("mixed content").
   Un seul domaine stable pour le QR code : le wallet jetable vit dans le localStorage de CE domaine
   (jamais les URL de preview `aura-farm-battle-xxxx.vercel.app`).

## Voir les blocs

- **Téléphone** (`web/src/BlockTrail.jsx`) : sous le personnage, une frise de 10 cases, une par bloc de 0,3 s,
  qui défile en continu. Les cases contenant tes taps affichent `+N` et s'affirment quand le bloc avance dans
  le consensus : contour pointillé jaune = proposé, jaune translucide = voté, jaune plein = finalisé.
  La case en pointillés à droite compte les taps pas encore inclus. En dessous : « vu en X ms · finalisé en Y ms ».
- **Écran géant** : les barres du ruban passent du blanc (proposé) au jaune (voté) puis au vert (finalisé).
- Sur le testnet ces états viennent de `monadNewHeads`. Anvil ne les connaît pas : en local le serveur
  les imite (voté à +1 bloc, finalisé à +2), ce qui correspond au pipeline de MonadBFT.

L'interface est volontairement épurée (pas d'emojis, surfaces translucides, beaucoup d'espace) et utilise la palette Monad (`web/src/index.css`) : violet `#836EF9`, violet profond `#200052`,
berry `#A0055D`, blanc cassé `#FBFAF9`, noir `#0E100F`.

## Personnages

Un brainrot par palier d'évolution (`STAGES` dans `shared/config.mjs`) : Chimpanzini Bananini →
Ballerina Cappuccina → Lirili Larilà → Tung Tung Tung Sahur → Bombardiro Crocodilo → Tralalero Tralala.
Ils sont dessinés en SVG dans `web/src/Brainrot.jsx` ; la galerie est sur `/sprites`.
Pour utiliser une vraie image : dépose `web/public/sprites/<slug>.png` (ex. `tralalero-tralala.png`),
elle remplace le dessin automatiquement. Vérifie que tu as le droit d'utiliser l'image.

## Budget MON

Mesuré (`node scripts/gas.mjs --local`) : un `tap()` = **50 182 gas**, identique pour 1 ou 20 taps agrégés.
Sur Monad on paie la **gas limit** (51 800) × le prix (plancher 100 gwei) = **0,00518 MON par transaction**.
Le prix ne peut pas descendre sous 100 gwei : le seul vrai levier est le **nombre de transactions**.

| Mode (30 joueurs, round de 30 s) | tx / joueur / s | tx par round | coût |
|---|---|---|---|
| Finale : 1 tap = 1 tx (~6 taps/s) | 6 | 5 400 | ~28 MON |
| Bloc : 1 tx par bloc (300 ms) | 3,3 | 3 000 | ~15,5 MON |
| Éco : 1 tx / 600 ms | 1,7 | 1 500 | ~8 MON |

Le mode se choisit par round depuis la régie de l'écran géant. `join()` coûte 0,011 MON par joueur, une fois.

## Pièges Monad traités dans le code

- **Reserve balance côté admin** (trouvé sur le testnet, invisible sur anvil) : un compte sous 10 MON ne peut envoyer de
  la VALEUR qu'une fois tous les 3 blocs ; les autres transferts sont annulés à l'exécution, nonce consommé, sans erreur
  RPC. Trente dotations d'affilée = une seule qui passe. D'où `AuraDrip.sol` : l'admin alimente le contrat une fois, puis
  chaque dotation est un appel SANS valeur (l'admin ne paie que du gas) qui sert jusqu'à 40 joueurs en une tx.
- Un `join()` envoyé trop tôt après la dotation peut être accepté par le RPC puis jamais inclus : le téléphone vérifie
  l'inscription SUR LA CHAÎNE et réessaie (avec +1 gas pour changer le hash, sinon le RPC répond "déjà connue").
- `cloudflared` utilise QUIC (UDP) par défaut, souvent bloqué : `pnpm prod` force `--protocol http2`.

- Gas facturé sur la limite → limites en dur (`shared/config.mjs`), jamais d'`eth_estimateGas` en jeu.
- Pas de mempool global → nonces gérés en local + chien de garde qui renvoie les tx perdues (`shared/pump.mjs`).
- Compte fraîchement alimenté → attendre 3 blocs avant la première tx (état "Charging aura").
- `monadLogs` republie chaque log à chaque état du bloc → dédoublonnage sur `(blockId, logIndex)` (`shared/feed.mjs`).
- `block.timestamp` à la seconde → rounds et revenu passif comptés en `block.number`.
- `eth_getLogs` limité à ~100 blocs → `snapshot()` on-chain pour reconstruire le classement en un appel.
- Résultat officiel relu dans l'état `finalized` ~0,6 s après la fin du round.
