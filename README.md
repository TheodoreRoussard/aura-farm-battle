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
| `contracts/` | `AuraFarm.sol` + tests Foundry (`network = "monad"` → barème de gas Monad / MIP-8) |
| `shared/` | code commun front / serveur / scripts : config + ABI, `TxPump` (nonces locaux), `openFeed` (monadLogs) |
| `scripts/` | `deploy`, `gas` (mesure), `load` (test de charge), `round` (régie en CLI) |
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

1. `cast wallet new` → mets la clé dans `.env` (`ADMIN_PRIVATE_KEY`), envoie-lui tes MON du faucet.
2. `pnpm deploy:testnet` puis la commande `forge verify-contract ...` affichée (Sourcify, sans clé API).
3. **Go / no-go** : `pnpm load -- --players 5 --seconds 10` (≈ 0,8 MON, le reste est rapatrié).
   À lire dans le bilan : 0 tx abandonnée, 0 revert, taps envoyés = taps on-chain, erreurs RPC.
4. Serveur sur une machine qui reste allumée (laptop + `cloudflared tunnel --url http://localhost:8787`, ou Railway).
5. Front sur Vercel, variables `VITE_NETWORK=testnet` et `VITE_SERVER_URL=https://...`.
   Attention : `web/` importe `../shared/`. Deux réglages possibles, **à vérifier par un premier déploiement** :
   Root Directory = `web` avec l'option "Include source files outside of the Root Directory" activée,
   ou Root Directory = racine du dépôt, build `pnpm -C web build`, output `web/dist`.
   Un seul domaine stable pour le QR code : le wallet jetable vit dans le localStorage de CE domaine.

## Personnages

Un brainrot par palier d'évolution (`STAGES` dans `shared/config.mjs`) : Chimpanzini Bananini →
Ballerina Cappuccina → Lirili Larilà → Tung Tung Tung Sahur → Bombardiro Crocodilo → Tralalero Tralala.
Ils sont dessinés en SVG dans `web/src/Brainrot.jsx` ; la galerie est sur `/sprites`.
Pour utiliser une vraie image : dépose `web/public/sprites/<slug>.png` (ex. `tralalero-tralala.png`),
elle remplace le dessin automatiquement. Vérifie que tu as le droit d'utiliser l'image.

## Budget MON

Mesuré (`node scripts/gas.mjs --local`) : un `tap()` = **45 164 gas**, identique pour 1 ou 20 taps agrégés.
Sur Monad on paie la **gas limit** (46 600) × le prix (plancher 100 gwei) = **0,00466 MON par transaction**.
Le prix ne peut pas descendre sous 100 gwei : le seul vrai levier est le **nombre de transactions**.

| Mode (30 joueurs, round de 30 s) | tx / joueur / s | tx par round | coût |
|---|---|---|---|
| Finale : 1 tap = 1 tx (~6 taps/s) | 6 | 5 400 | ~25 MON |
| Bloc : 1 tx par bloc (300 ms) | 3,3 | 3 000 | ~14 MON |
| Éco : 1 tx / 600 ms | 1,7 | 1 500 | ~7 MON |

Le mode se choisit par round depuis la régie de l'écran géant. `join()` coûte 0,011 MON par joueur, une fois.

## Pièges Monad traités dans le code

- Gas facturé sur la limite → limites en dur (`shared/config.mjs`), jamais d'`eth_estimateGas` en jeu.
- Pas de mempool global → nonces gérés en local + chien de garde qui renvoie les tx perdues (`shared/pump.mjs`).
- Compte fraîchement alimenté → attendre 3 blocs avant la première tx (état "Charging aura").
- `monadLogs` republie chaque log à chaque état du bloc → dédoublonnage sur `(blockId, logIndex)` (`shared/feed.mjs`).
- `block.timestamp` à la seconde → rounds et revenu passif comptés en `block.number`.
- `eth_getLogs` limité à ~100 blocs → `snapshot()` on-chain pour reconstruire le classement en un appel.
- Résultat officiel relu dans l'état `finalized` ~0,6 s après la fin du round.
