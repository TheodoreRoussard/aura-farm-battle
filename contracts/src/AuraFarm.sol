// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Aura Farm Battle
/// @notice Clicker on-chain : chaque flush de taps est une transaction Monad.
/// @dev Tout est pensé pour que `tap()` coûte un gas CONSTANT et minimal, car sur Monad
///      on paie la gas limit (pas le gas consommé) : le front fixe la limite en dur.
contract AuraFarm {
    // ───────────────────────── État global : 1 seul slot ─────────────────────────
    // Un tap ne lit qu'une page de stockage "à froid" pour la config du round (MIP-8).
    struct Game {
        uint32 round; // 0 = aucun round lancé
        uint40 startBlock; // premier bloc où tap() est accepté
        uint40 endBlock; // premier bloc où tap() est refusé
        uint8 maxPerTx; // taps max par transaction (1 = mode "1 tap = 1 tx")
    }

    // ───────────────────────── État joueur : 1 seul slot ─────────────────────────
    // 48+48+32+32+16+16+16+8+24+8+8 = 256 bits. Chaque joueur écrit dans SON slot : aucun conflit
    // entre joueurs, donc le cas idéal pour l'exécution parallèle de Monad. Toutes les améliorations
    // tiennent dans ce même slot : tap() ne paie toujours qu'une lecture et une écriture.
    struct Player {
        uint48 total; // aura gagnée sur le round (ne baisse jamais → classement)
        uint48 spent; // toujours 0 : les améliorations se DÉBLOQUENT à un seuil d'aura, elles ne la consomment pas
        uint32 lastBlock; // dernier bloc où le revenu passif a été réglé
        uint32 boostUntil; // le bonus "x5" est actif tant que block.number < boostUntil
        uint16 round; // round auquel appartiennent ces valeurs (0 = jamais inscrit)
        uint16 rate; // niveau "Brr Brr Patapim" : +1 aura passive par bloc
        uint16 power; // niveau "Cappuccino Assassino" : +1 aura par tap (démarre à 1)
        uint8 mult; // niveau "Espresso Sigma" : chaque niveau multiplie les taps par 1,01
        uint24 multBps; // multiplicateur courant en 1/10 000 (10 000 = x1) : calculé à l'achat, pas au tap
        uint8 magnet; // niveau "Aimant à bonus" : le bonus dure ~2 s de plus
        uint8 frac; // centièmes d'aura en report (le multiplicateur donne des fractions)
    }

    uint8 public constant KIND_POWER = 0;
    uint8 public constant KIND_RATE = 1;
    uint8 public constant KIND_MULT = 2;
    uint8 public constant KIND_MAGNET = 3;
    uint8 public constant MULT_MAX = 250; // x1,01^250 ≈ x12

    // Bonus "x5" : le front fait apparaître une bulle, le joueur la touche → claimBonus().
    uint32 public constant BOOST_BLOCKS = 17; // ~5 s
    uint32 public constant BOOST_PER_MAGNET = 7; // ~2 s par niveau d'aimant
    uint32 public constant BONUS_GAP = 40; // ~12 s de repos entre la fin d'un bonus et le suivant (anti-abus)
    uint64 public constant BOOST_MULT = 5;

    address public immutable host;
    Game public game;
    mapping(address => Player) private _players;
    address[] public roster; // pour reconstruire le classement en 1 eth_call

    event RoundStarted(uint32 indexed round, uint40 startBlock, uint40 endBlock, uint8 maxPerTx);
    event RoundStopped(uint32 indexed round, uint40 endBlock);
    event Joined(address indexed player);
    /// @dev Valeurs ABSOLUES (pas des deltas) : recevoir l'event 3 fois (Proposed/Voted/
    ///      Finalized via monadLogs) est sans effet, il suffit de garder le plus grand total.
    /// @param extra mult | magnet << 8 | multBps << 16
    event PlayerUpdated(
        address indexed player, uint32 round, uint64 total, uint64 spent, uint24 rate, uint24 power, uint64 extra, uint40 boostUntil
    );

    error NotHost();
    error NotJoined();
    error RoundNotLive();
    error BadCount();
    error BadKind();
    error TooPoor();
    error MaxLevel();
    error BonusCooldown();

    constructor() {
        host = msg.sender;
    }

    // ───────────────────────────────── Hôte ─────────────────────────────────

    /// @param delayBlocks compte à rebours avant le départ (10 blocs ≈ 3 s)
    /// @param durationBlocks durée du round (100 blocs ≈ 30 s)
    /// @param maxPerTx taps max agrégés par transaction
    function startRound(uint32 delayBlocks, uint32 durationBlocks, uint8 maxPerTx) external {
        if (msg.sender != host) revert NotHost();
        if (maxPerTx == 0 || durationBlocks == 0) revert BadCount();
        Game memory g = game;
        g.round += 1;
        g.startBlock = uint40(block.number) + delayBlocks;
        g.endBlock = g.startBlock + durationBlocks;
        g.maxPerTx = maxPerTx;
        game = g;
        emit RoundStarted(g.round, g.startBlock, g.endBlock, maxPerTx);
    }

    /// @notice Bouton d'arrêt d'urgence (stoppe aussi la dépense de MON de la salle).
    function stopRound() external {
        if (msg.sender != host) revert NotHost();
        if (block.number < game.endBlock) game.endBlock = uint40(block.number);
        emit RoundStopped(game.round, game.endBlock);
    }

    // ──────────────────────────────── Joueurs ────────────────────────────────

    /// @notice Inscription, une seule fois par adresse. Séparée de tap() pour que
    ///         tap() n'ait jamais à payer la création de slots (17 000 gas de state growth).
    function join() external {
        Player storage p = _players[msg.sender];
        if (p.power != 0) return; // déjà inscrit : idempotent
        p.power = 1;
        roster.push(msg.sender);
        emit Joined(msg.sender);
    }

    /// @param count nombre de taps accumulés côté client depuis le dernier envoi
    function tap(uint8 count) external {
        Game memory g = game;
        if (block.number < g.startBlock || block.number >= g.endBlock) revert RoundNotLive();
        if (count == 0 || count > g.maxPerTx) revert BadCount();
        Player memory p = _settle(_players[msg.sender], g);
        uint64 gain = uint64(count) * p.power * p.multBps / 100; // en centièmes d'aura
        if (block.number < p.boostUntil) gain *= BOOST_MULT;
        gain += p.frac;
        p.total += uint48(gain / 100);
        p.frac = uint8(gain % 100);
        _save(p);
    }

    /// @notice Débloque le niveau suivant d'une amélioration quand l'aura totale atteint son seuil.
    ///         L'aura n'est pas dépensée : le score affiché reste l'aura gagnée sur tout le round.
    function buy(uint8 kind) external {
        Game memory g = game;
        if (block.number < g.startBlock || block.number >= g.endBlock) revert RoundNotLive();
        Player memory p = _settle(_players[msg.sender], g);
        uint64 cost;
        if (kind == KIND_POWER) {
            if (p.power >= 1000) revert MaxLevel();
            cost = powerCost(p.power);
            p.power += 1;
        } else if (kind == KIND_RATE) {
            if (p.rate >= 1000) revert MaxLevel();
            cost = rateCost(p.rate);
            p.rate += 1;
        } else if (kind == KIND_MULT) {
            if (p.mult >= MULT_MAX) revert MaxLevel();
            cost = multCost(p.mult);
            p.mult += 1;
            p.multBps = uint24(uint256(p.multBps) * 101 / 100); // x1,01 composé
        } else if (kind == KIND_MAGNET) {
            if (p.magnet >= 10) revert MaxLevel();
            cost = magnetCost(p.magnet);
            p.magnet += 1;
        } else {
            revert BadKind();
        }
        if (p.total < cost) revert TooPoor();
        _save(p);
    }

    /// @notice Active le bonus x5 sur les taps. Le front n'appelle ceci que quand le joueur touche
    ///         la bulle ; le contrat borne l'abus avec un temps de repos (BONUS_GAP).
    function claimBonus() external {
        Game memory g = game;
        if (block.number < g.startBlock || block.number >= g.endBlock) revert RoundNotLive();
        Player memory p = _settle(_players[msg.sender], g);
        if (block.number < uint256(p.boostUntil) + BONUS_GAP) revert BonusCooldown();
        p.boostUntil = uint32(block.number) + BOOST_BLOCKS + BOOST_PER_MAGNET * uint32(p.magnet);
        _save(p);
    }

    // ───────────────────────────────── Vues ─────────────────────────────────

    function powerCost(uint24 power) public pure returns (uint64) {
        return 20 * uint64(power) * uint64(power); // 20, 80, 180, 320...
    }

    function rateCost(uint24 rate) public pure returns (uint64) {
        return 30 * (uint64(rate) + 1) * (uint64(rate) + 1); // 30, 120, 270...
    }

    function multCost(uint24 level) public pure returns (uint64) {
        return 10 * (uint64(level) + 1) * (uint64(level) + 1); // 10, 40, 90... : seuil qui monte à chaque niveau
    }

    function magnetCost(uint24 level) public pure returns (uint64) {
        return 200 * (uint64(level) + 1) * (uint64(level) + 1); // 200, 800, 1800...
    }

    function players(address who) external view returns (Player memory) {
        return _players[who];
    }

    /// @notice Total "officiel" d'un joueur pour le round courant, revenu passif non
    ///         encore réglé inclus (plafonné à endBlock). C'est ce que le front projette.
    function totalOf(address who) external view returns (uint64) {
        Player memory p = _players[who];
        Game memory g = game;
        if (p.round != uint16(g.round)) return 0;
        uint256 nowB = block.number < g.endBlock ? block.number : g.endBlock;
        if (nowB <= p.lastBlock) return p.total;
        return uint64(p.total) + uint64(uint256(p.rate) * (nowB - p.lastBlock));
    }

    function rosterLength() external view returns (uint256) {
        return roster.length;
    }

    /// @notice État complet paginé : sert à (re)construire le classement après un
    ///         rafraîchissement de page, eth_getLogs étant limité à ~100 blocs.
    function snapshot(uint256 offset, uint256 limit)
        external
        view
        returns (Game memory g, uint256 blockNumber, address[] memory addrs, Player[] memory list)
    {
        g = game;
        blockNumber = block.number;
        uint256 n = roster.length;
        if (offset > n) offset = n;
        if (limit > n - offset) limit = n - offset;
        addrs = new address[](limit);
        list = new Player[](limit);
        for (uint256 i = 0; i < limit; i++) {
            addrs[i] = roster[offset + i];
            list[i] = _players[addrs[i]];
        }
    }

    // ──────────────────────────────── Interne ────────────────────────────────

    /// @dev Règle le revenu passif "paresseusement" : rien ne tourne en tâche de fond,
    ///      on calcule rate × blocs écoulés à la prochaine interaction du joueur.
    ///      On compte en block.number : block.timestamp est à la seconde près et
    ///      3-4 blocs Monad partagent le même.
    function _settle(Player memory p, Game memory g) private view returns (Player memory) {
        if (p.power == 0) revert NotJoined();
        if (p.round != uint16(g.round)) {
            // premier tap du round : remise à zéro sans toucher à un autre slot
            p.round = uint16(g.round);
            p.total = 0;
            p.spent = 0;
            p.boostUntil = 0;
            p.rate = 0;
            p.power = 1;
            p.mult = 0;
            p.multBps = 10_000;
            p.magnet = 0;
            p.frac = 0;
        } else {
            p.total += uint48(uint256(p.rate) * (block.number - p.lastBlock));
        }
        p.lastBlock = uint32(block.number);
        return p;
    }

    function _save(Player memory p) private {
        _players[msg.sender] = p;
        uint64 extra = uint64(p.mult) | uint64(p.magnet) << 8 | uint64(p.multBps) << 16;
        emit PlayerUpdated(msg.sender, p.round, p.total, p.spent, p.rate, p.power, extra, p.boostUntil);
    }
}
