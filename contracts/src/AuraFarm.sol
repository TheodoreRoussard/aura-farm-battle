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
    // 64+64+40+24+24+32 = 248 bits. Chaque joueur écrit dans SON slot : aucun conflit
    // entre joueurs, donc le cas idéal pour l'exécution parallèle de Monad.
    struct Player {
        uint64 total; // aura gagnée sur le round (ne baisse jamais → classement)
        uint64 spent; // aura dépensée en améliorations (solde = total - spent)
        uint40 lastBlock; // dernier bloc où le revenu passif a été réglé
        uint24 rate; // aura passive par bloc
        uint24 power; // aura par tap
        uint32 round; // round auquel appartiennent ces valeurs (0 = jamais inscrit)
    }

    uint8 public constant KIND_POWER = 0;
    uint8 public constant KIND_RATE = 1;

    address public immutable host;
    Game public game;
    mapping(address => Player) public players;
    address[] public roster; // pour reconstruire le classement en 1 eth_call

    event RoundStarted(uint32 indexed round, uint40 startBlock, uint40 endBlock, uint8 maxPerTx);
    event RoundStopped(uint32 indexed round, uint40 endBlock);
    event Joined(address indexed player);
    /// @dev Valeurs ABSOLUES (pas des deltas) : recevoir l'event 3 fois (Proposed/Voted/
    ///      Finalized via monadLogs) est sans effet, il suffit de garder le plus grand total.
    event PlayerUpdated(address indexed player, uint32 round, uint64 total, uint64 spent, uint24 rate, uint24 power);

    error NotHost();
    error NotJoined();
    error RoundNotLive();
    error BadCount();
    error BadKind();
    error TooPoor();

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
        Player storage p = players[msg.sender];
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
        Player memory p = _settle(players[msg.sender], g);
        p.total += uint64(count) * p.power;
        _save(p);
    }

    /// @notice Achète une amélioration avec de l'aura (jamais avec des MON).
    function buy(uint8 kind) external {
        Game memory g = game;
        if (block.number < g.startBlock || block.number >= g.endBlock) revert RoundNotLive();
        Player memory p = _settle(players[msg.sender], g);
        uint64 cost;
        if (kind == KIND_POWER) {
            cost = powerCost(p.power);
            p.power += 1;
        } else if (kind == KIND_RATE) {
            cost = rateCost(p.rate);
            p.rate += 1;
        } else {
            revert BadKind();
        }
        if (p.total - p.spent < cost) revert TooPoor();
        p.spent += cost;
        _save(p);
    }

    // ───────────────────────────────── Vues ─────────────────────────────────

    function powerCost(uint24 power) public pure returns (uint64) {
        return 20 * uint64(power) * uint64(power); // 20, 80, 180, 320...
    }

    function rateCost(uint24 rate) public pure returns (uint64) {
        return 30 * (uint64(rate) + 1) * (uint64(rate) + 1); // 30, 120, 270...
    }

    /// @notice Total "officiel" d'un joueur pour le round courant, revenu passif non
    ///         encore réglé inclus (plafonné à endBlock). C'est ce que le front projette.
    function totalOf(address who) external view returns (uint64) {
        Player memory p = players[who];
        Game memory g = game;
        if (p.round != g.round) return 0;
        uint40 nowB = uint40(block.number < g.endBlock ? block.number : g.endBlock);
        if (nowB <= p.lastBlock) return p.total;
        return p.total + uint64(p.rate) * (nowB - p.lastBlock);
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
            list[i] = players[addrs[i]];
        }
    }

    // ──────────────────────────────── Interne ────────────────────────────────

    /// @dev Règle le revenu passif "paresseusement" : rien ne tourne en tâche de fond,
    ///      on calcule rate × blocs écoulés à la prochaine interaction du joueur.
    ///      On compte en block.number : block.timestamp est à la seconde près et
    ///      3-4 blocs Monad partagent le même.
    function _settle(Player memory p, Game memory g) private view returns (Player memory) {
        if (p.power == 0) revert NotJoined();
        if (p.round != g.round) {
            // premier tap du round : remise à zéro sans toucher à un autre slot
            p.round = g.round;
            p.total = 0;
            p.spent = 0;
            p.rate = 0;
            p.power = 1;
        } else {
            p.total += uint64(p.rate) * (uint40(block.number) - p.lastBlock);
        }
        p.lastBlock = uint40(block.number);
        return p;
    }

    function _save(Player memory p) private {
        players[msg.sender] = p;
        emit PlayerUpdated(msg.sender, p.round, p.total, p.spent, p.rate, p.power);
    }
}
