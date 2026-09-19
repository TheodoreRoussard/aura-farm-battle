// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title AuraDrip — distributeur de MON pour les wallets jetables des joueurs.
/// @notice Pourquoi un contrat et pas de simples transferts depuis le wallet admin : sur Monad, un compte
///         dont le solde est sous 10 MON ("reserve balance") ne peut envoyer de la VALEUR qu'une seule fois
///         tous les 3 blocs ; les autres transferts sont annulés à l'exécution. Trente joueurs qui scannent
///         le QR code en même temps = trente transferts d'affilée = un seul qui passe.
///         Ici l'admin alimente le contrat UNE fois, puis chaque dotation est un appel sans valeur
///         (l'admin ne paie que du gas, ce que la règle autorise) qui sert plusieurs joueurs d'un coup.
contract AuraDrip {
    address public immutable host;

    error NotHost();
    error Empty();

    event Dripped(uint256 count, uint256 amount);

    constructor() payable {
        host = msg.sender;
    }

    receive() external payable {}

    modifier onlyHost() {
        if (msg.sender != host) revert NotHost();
        _;
    }

    /// @notice Envoie `amount` à chaque adresse. Un destinataire qui refuse le paiement est ignoré
    ///         (il ne bloque pas les autres) ; `gas: 0` = seulement l'allocation de 2300 gas d'un transfert.
    function drip(address payable[] calldata to, uint256 amount) external onlyHost {
        if (address(this).balance < amount * to.length) revert Empty();
        for (uint256 i; i < to.length; ++i) {
            (bool ok,) = to[i].call{value: amount, gas: 0}("");
            ok; // échec volontairement ignoré
        }
        emit Dripped(to.length, amount);
    }

    /// @notice Rapatrie tout le solde vers l'admin (fin de journée, ou pour rééquilibrer).
    function withdraw() external onlyHost {
        (bool ok,) = host.call{value: address(this).balance}("");
        require(ok);
    }
}
