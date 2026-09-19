# Aura Farm Battle 🍝⚡

**Un clicker multijoueur "brainrot italien" où chaque tap part on-chain sur Monad.**
Toute la salle scanne un QR code, tape sur son personnage pendant 30 secondes, et un écran géant affiche en direct
le classement, les transactions par seconde et chaque bloc qui passe de *proposé* à *finalisé*.

> Projet réalisé pour le **Monad Blitz Paris**.

| | |
|---|---|
| 🎮 **Jouer** (téléphone) | https://aura-farm-battle.vercel.app/?room=AURA |
| 📺 **Écran géant + régie** (ordinateur) | https://aura-farm-battle.vercel.app/screen |
| 📜 **Contrat du jeu** (testnet) | [`AuraFarm` 0x623a…303e](https://testnet.monadvision.com/address/0x623a4c9d7dd983ba566e48b128592d141d92303e) |
| 💧 **Distributeur de MON** (testnet) | [`AuraDrip` 0x29d0…2d6a](https://testnet.monadvision.com/address/0x29d00269588c49353cf57e4e18d03983db1a2d6a) |

## Pourquoi c'est un jeu pour Monad

Un clicker, c'est des milliers d'actions minuscules par minute. Sur la plupart des chaînes, il faudrait les regrouper
hors chaîne et ne poster que le score final. Ici, **les taps partent en transactions, en continu, pendant la partie** :

- **Blocs de 0,3 s** → le score d'un joueur est vu on-chain en ~300 ms et **finalisé en ~850 ms** (mesuré sur le testnet).
- **Exécution parallèle** → chaque joueur n'écrit que dans **son propre slot de stockage** : aucune transaction de la salle
  n'entre en conflit avec une autre, le cas idéal pour le parallélisme de Monad.
- **MonadBFT rendu visible** → grâce à `monadLogs` / `monadNewHeads`, le téléphone et l'écran géant colorent chaque bloc
  selon son état de consensus : proposé → voté → finalisé.
- **Zéro friction** → pas de wallet à installer, pas de MON à avoir : le téléphone crée un wallet jetable et reçoit
  automatiquement de quoi payer son gas.

## Comment on joue

1. **L'animateur** ouvre l'écran géant sur son ordinateur, tape le code régie : le QR code apparaît, la musique démarre.
2. **Les joueurs** scannent le QR code, choisissent un pseudo. En ~5 s, leur wallet est créé, alimenté et inscrit on-chain.
3. **Décompte 3-2-1, GO** : tout le monde tape sur son personnage pendant 30 s.
4. L'aura débloque des **évolutions** (6 brainrots, de Chimpanzini Bananini à Tralalero Tralala) et des **améliorations** :

   | Amélioration | Effet | Seuil de déblocage |
   |---|---|---|
   | ☕ Cappuccino Assassino | +1 aura par tap | 20, 80, 180… |
   | 📈 Espresso Sigma | taps × 1,01, **composé** à chaque niveau | 10, 40, 90… |
   | 🌿 Brr Brr Patapim | +1 aura par bloc, même sans taper | 30, 120, 270… |
   | 🧲 Aimant à Bonus | le bonus dure ~2 s de plus | 200, 800… |

   Les améliorations se **débloquent** quand l'aura atteint le seuil : rien n'est dépensé, le score reste l'aura totale.
5. Une **bulle ⚡** apparaît de temps en temps : la toucher donne **AURA x5** pendant ~5 s (délai de repos vérifié par le contrat).
6. Fin du round : le résultat **officiel** est relu dans l'état *finalisé* de la chaîne, puis affiché partout avec le podium.

Sur le téléphone : top 3 en direct, notification « X t'a volé la 1re place », frise des blocs contenant *tes* taps,
latence de chaque transaction. Sur l'écran géant : classement animé, compteur de transactions par seconde, ruban de blocs.

## Architecture

```
Téléphones (web/)  ── tx signées en local ──▶  RPC Monad testnet  ──▶  AuraFarm.sol
      ▲                                                                   │ events (monadLogs)
      └── WebSocket : classement, bloc courant ──  server/  ◀─────────────┘
                                                   dotations (via AuraDrip.sol) · indexeur · régie
Écran géant (web/ → /screen) ◀─────────────────────┘
```

- **Les taps ne passent pas par le serveur** : chaque téléphone signe ses transactions avec son wallet jetable et les
  envoie directement au RPC. Le serveur ne fait qu'alimenter les wallets, indexer les events et piloter les rounds.
- **Le téléphone ne demande rien à la chaîne avant d'envoyer** (`shared/pump.mjs`) : nonce compté en local, limite de gas
  fixe, frais en cache. Un chien de garde renvoie les transactions perdues (Monad n'a pas de mempool global).
- **Taps agrégés** : selon le mode choisi par la régie, jusqu'à 20 taps partent dans une même transaction, toutes les
  secondes (Éco), à chaque bloc (Bloc) ou 1 tap = 1 transaction (Finale).
- **Affichage optimiste** : le compteur monte au tap, la chaîne confirme derrière ; les améliorations, elles,
  attendent l'aura confirmée on-chain.

### Le contrat `AuraFarm.sol`

- **Tout l'état d'un joueur tient dans un seul slot de 256 bits** (aura, niveaux, bonus, report des fractions) :
  un `tap()` = une lecture + une écriture, à **gas constant**. Sur Monad on paie la limite de gas, pas le gas consommé :
  la limite est fixée en dur, jamais estimée pendant le jeu.
- **Revenu passif réglé paresseusement** : rien ne tourne en tâche de fond, le contrat calcule `taux × blocs écoulés`
  à la prochaine interaction du joueur.
- **Remise à zéro paresseuse** entre les rounds : le premier tap d'un round réinitialise le slot, sans boucle sur les joueurs.
- **Le multiplicateur x1,01 composé** est calculé à l'achat, pas au tap ; les centièmes d'aura sont reportés d'une
  transaction à l'autre, rien n'est perdu à l'arrondi.
- **Events en valeurs absolues** : recevoir trois fois le même log (proposé, voté, finalisé) est sans effet.
- `snapshot()` reconstruit tout le classement en un appel (`eth_getLogs` est limité à ~100 blocs).

### Le distributeur `AuraDrip.sol`

Sur Monad, un compte sous 10 MON ne peut envoyer de **valeur** qu'une fois tous les 3 blocs (*reserve balance*) :
trente joueurs qui scannent en même temps = une seule dotation qui passe. L'admin alimente donc le contrat une fois,
puis chaque dotation est un appel **sans valeur** (l'admin ne paie que du gas) qui sert jusqu'à 20 joueurs d'un coup.

## Mesures

| | |
|---|---|
| Tap vu on-chain (testnet, p50) | **313 ms** |
| Tap finalisé (testnet, p50) | **850 ms** |
| Gas d'un `tap()` (1 ou 20 taps agrégés) | ~50 000, limite 51 800 |
| Coût d'une transaction | 0,0052 MON (limite × 100 gwei) |
| Scan du QR code → prêt à jouer | ~5 s (dotation, 3 blocs d'attente imposés par Monad, inscription) |

**Simulation d'une partie** (24 joueurs, 3 rounds, avec le vrai code du téléphone, sur un Monad local) :
0 transaction annulée en modes Éco et Finale, mêmes scores sur la chaîne, le serveur et les téléphones,
retour automatique des téléphones 10 s après une coupure du serveur.

**Coût d'un round de 30 s avec 30 joueurs** : ~4,7 MON en mode Éco (1 tx/s), ~15,5 MON en mode Bloc, ~28 MON en Finale.

## Pièges Monad rencontrés (et traités)

- **Reserve balance** : les transferts de valeur de l'admin étaient annulés sans erreur RPC → distributeur `AuraDrip`.
- **Compte fraîchement alimenté** : il faut attendre 3 blocs avant sa première transaction (écran « Charging aura »).
- **Pas de mempool global** : une transaction perdue bloque toutes les suivantes → nonces locaux + chien de garde.
- **`join()` accepté puis jamais inclus** : l'inscription est vérifiée *sur la chaîne*, avec renvoi (+1 gas pour changer le hash).
- **`monadLogs` republie chaque log à chaque état du bloc** → dédoublonnage sur `(blockId, logIndex)`.
- **Gas facturé sur la limite** → limites mesurées puis fixées en dur (`shared/config.mjs`).
- **`block.timestamp` à la seconde** (3-4 blocs par seconde) → rounds et revenu passif comptés en `block.number`.

## Structure du dépôt

| Dossier | Rôle |
|---|---|
| `contracts/` | `AuraFarm.sol` (le jeu), `AuraDrip.sol` (distributeur de MON), tests Foundry (barème de gas Monad) |
| `shared/` | code commun front / serveur / scripts : config + ABI, `TxPump` (envoi des tx), `openFeed` (monadLogs), pseudos |
| `server/` | dotations, indexeur en mémoire, diffusion WebSocket, régie |
| `web/` | Vite + React + Tailwind : `/` = téléphone, `/screen` = écran géant, `/sprites` = galerie des personnages |
| `scripts/` | `demo`, `deploy`, `prod`, `gas` (mesure), `load` (test de charge), `round`, `drip` |

## Lancer le projet en local (aucun MON nécessaire)

Prérequis : Node 22, pnpm, [Foundry](https://getfoundry.sh) ≥ 1.8.

```sh
pnpm install
pnpm demo      # chaîne Monad locale (anvil, blocs de 0,3 s), contrats, serveur et front en une commande
```

- Joueur : `http://<ip-du-laptop>:5173/?room=AURA` (même Wi-Fi) — écran géant : l'URL affichée par `pnpm demo`
- Tests des contrats : `pnpm test:contracts`
- Simuler une salle : `pnpm load -- --local --players 25 --seconds 25`

## Déployer sur le testnet

1. `cast wallet new` → clé dans `.env` (`ADMIN_PRIVATE_KEY`, voir `.env.example`), MON du faucet sur cette adresse.
   Choisir un `ADMIN_TOKEN` long : c'est le code régie.
2. `pnpm deploy:testnet` : déploie `AuraFarm` et `AuraDrip`, et alimente le distributeur.
   `-- --farm-only` ne redéploie que le jeu (en gardant le distributeur et ses MON), `-- --drip-only` que le distributeur.
3. Contrôle : `pnpm load -- --players 3 --seconds 6` doit donner 0 transaction abandonnée et 0 revert.
4. `pnpm prod` : lance le serveur, ouvre un tunnel HTTPS `cloudflared` vers lui, inscrit son URL dans Vercel
   (`VITE_SERVER_URL`) et redéploie le front. Le serveur reste sur la machine de l'animateur : la clé admin ne la
   quitte jamais, et Vercel ne sait pas garder de WebSocket ouvert.
5. Le front est sur Vercel, projet lié à la racine du dépôt (`vercel.json`) : chaque push sur `main` le redéploie.

Recharger le distributeur pendant la journée : envoyer des MON du faucet à son adresse, ou `pnpm drip -- fund <MON>`.
Le serveur relit son solde toutes les 5 s.

## Personnages

Chimpanzini Bananini → Ballerina Cappuccina → Lirili Larilà → Tung Tung Tung Sahur → Bombardiro Crocodilo →
Tralalero Tralala, dessinés en SVG (`web/src/Brainrot.jsx`, galerie sur `/sprites`). Une vraie image déposée dans
`web/public/sprites/<slug>.png` remplace automatiquement le dessin.

## Équipe

- Noé — [@noegng](https://github.com/noegng)
- Théodore Roussard — [@TheodoreRoussard](https://github.com/TheodoreRoussard)
