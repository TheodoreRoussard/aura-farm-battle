// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AuraFarm} from "../src/AuraFarm.sol";

contract AuraFarmTest is Test {
    AuraFarm farm;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        farm = new AuraFarm(); // host = ce contrat de test
        vm.roll(1000);
        vm.prank(alice);
        farm.join();
        vm.prank(bob);
        farm.join();
    }

    function _start(uint32 delay, uint32 duration, uint8 maxPerTx) internal {
        farm.startRound(delay, duration, maxPerTx);
        vm.roll(vm.getBlockNumber() + delay);
    }

    function _player(address who) internal view returns (AuraFarm.Player memory) {
        return farm.players(who);
    }

    /// @dev Donne `n` aura à `who` (tap(20) x n/20, mode 1 tx = 20 taps à 1 aura).
    function _earn(address who, uint256 n) internal {
        vm.startPrank(who);
        for (uint256 i = 0; i < n / 20; i++) farm.tap(20);
        vm.stopPrank();
    }

    function test_TapAddsCountTimesPower() public {
        _start(10, 100, 20);
        vm.prank(alice);
        farm.tap(7);
        assertEq(_player(alice).total, 7);
        assertEq(farm.totalOf(alice), 7);
    }

    function test_RevertBeforeStartAndAfterEnd() public {
        farm.startRound(10, 100, 20);
        vm.prank(alice);
        vm.expectRevert(AuraFarm.RoundNotLive.selector);
        farm.tap(1);

        vm.roll(vm.getBlockNumber() + 110); // = endBlock
        vm.prank(alice);
        vm.expectRevert(AuraFarm.RoundNotLive.selector);
        farm.tap(1);
    }

    function test_RevertBadCount() public {
        _start(0, 100, 5);
        vm.startPrank(alice);
        vm.expectRevert(AuraFarm.BadCount.selector);
        farm.tap(0);
        vm.expectRevert(AuraFarm.BadCount.selector);
        farm.tap(6);
        vm.stopPrank();
    }

    function test_RevertIfNotJoined() public {
        _start(0, 100, 20);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(AuraFarm.NotJoined.selector);
        farm.tap(1);
    }

    function test_OnlyHost() public {
        vm.prank(alice);
        vm.expectRevert(AuraFarm.NotHost.selector);
        farm.startRound(0, 100, 20);
    }

    function test_UpgradesAndPassiveIncome() public {
        _start(0, 1000, 20);
        vm.startPrank(alice);
        farm.tap(20);
        farm.tap(20); // 40 aura
        farm.buy(farm.KIND_RATE()); // coûte 30 → rate = 1 aura/bloc
        assertEq(_player(alice).spent, 30);
        assertEq(_player(alice).rate, 1);

        vm.roll(vm.getBlockNumber() + 50); // 50 blocs de revenu passif, pas encore réglé on-chain
        assertEq(_player(alice).total, 40);
        assertEq(farm.totalOf(alice), 90); // ... mais visible via la vue

        farm.tap(1); // règle le passif + 1
        assertEq(_player(alice).total, 91);

        farm.buy(farm.KIND_POWER()); // coûte 20 → power = 2
        farm.tap(10);
        assertEq(_player(alice).total, 111);
        vm.stopPrank();
    }

    function test_RevertTooPoor() public {
        _start(0, 100, 20);
        vm.startPrank(alice);
        farm.tap(5);
        vm.expectRevert(AuraFarm.TooPoor.selector);
        farm.buy(0);
        vm.stopPrank();
    }

    function test_PassiveIncomeIsCappedAtEndBlock() public {
        _start(0, 100, 20);
        vm.startPrank(alice);
        farm.tap(20);
        farm.tap(20);
        farm.buy(1); // rate 1 au bloc de départ
        vm.stopPrank();
        vm.roll(vm.getBlockNumber() + 5000); // longtemps après la fin
        assertEq(farm.totalOf(alice), 40 + 100); // 100 blocs de round, pas 5000
    }

    function test_NewRoundResetsLazily() public {
        _start(0, 10, 20);
        vm.prank(alice);
        farm.tap(9);
        vm.roll(vm.getBlockNumber() + 10);

        _start(0, 10, 20);
        assertEq(farm.totalOf(alice), 0); // ancien round ignoré avant même le 1er tap
        vm.prank(alice);
        farm.tap(3);
        assertEq(_player(alice).total, 3);
        assertEq(_player(alice).round, 2);
    }

    function test_StopRound() public {
        _start(0, 1000, 20);
        farm.stopRound();
        vm.prank(alice);
        vm.expectRevert(AuraFarm.RoundNotLive.selector);
        farm.tap(1);
    }

    function test_Snapshot() public {
        _start(0, 100, 20);
        vm.prank(bob);
        farm.tap(4);
        (AuraFarm.Game memory g,, address[] memory addrs, AuraFarm.Player[] memory list) = farm.snapshot(0, 50);
        assertEq(g.round, 1);
        assertEq(addrs.length, 2);
        assertEq(addrs[1], bob);
        assertEq(list[1].total, 4);
        (,, addrs,) = farm.snapshot(1, 50);
        assertEq(addrs.length, 1);
    }

    function test_JoinIsIdempotent() public {
        vm.prank(alice);
        farm.join();
        assertEq(farm.rosterLength(), 2);
    }

    function test_MegaAndComboMultiplyTaps() public {
        _start(0, 1000, 20);
        _earn(alice, 200);
        vm.startPrank(alice);
        farm.buy(farm.KIND_MEGA()); // 150 → +5 par tap : 6 aura par tap
        farm.tap(10);
        assertEq(_player(alice).total, 200 + 60);
        vm.stopPrank();
    }

    function test_ComboAddsTenPercentPerLevel() public {
        _start(0, 1000, 20);
        _earn(alice, 400);
        vm.startPrank(alice);
        farm.buy(farm.KIND_COMBO()); // 400 → +10 %
        farm.tap(10); // 10 taps x 1 x 110 / 100 = 11
        assertEq(_player(alice).total, 400 + 11);
        vm.stopPrank();
    }

    function test_FarmAddsEightPerBlock() public {
        _start(0, 1000, 20);
        _earn(alice, 260);
        vm.startPrank(alice);
        farm.buy(farm.KIND_FARM()); // 250 → +8 aura par bloc
        vm.roll(vm.getBlockNumber() + 10);
        assertEq(farm.totalOf(alice), 260 + 80);
        vm.stopPrank();
    }

    function test_BonusMultipliesTapsFiveTimesThenExpires() public {
        _start(0, 1000, 20);
        vm.startPrank(alice);
        farm.claimBonus();
        farm.tap(4);
        assertEq(_player(alice).total, 4 * 5);
        vm.roll(vm.getBlockNumber() + farm.BOOST_BLOCKS()); // bonus terminé
        farm.tap(4);
        assertEq(_player(alice).total, 20 + 4);
        vm.stopPrank();
    }

    function test_BonusCooldown() public {
        _start(0, 1000, 20);
        vm.startPrank(alice);
        farm.claimBonus();
        vm.roll(vm.getBlockNumber() + farm.BOOST_BLOCKS() + 5);
        vm.expectRevert(AuraFarm.BonusCooldown.selector);
        farm.claimBonus();
        vm.roll(vm.getBlockNumber() + farm.BONUS_GAP());
        farm.claimBonus(); // repos écoulé
        vm.stopPrank();
    }

    function test_MagnetExtendsBonus() public {
        _start(0, 1000, 20);
        _earn(alice, 200);
        vm.startPrank(alice);
        farm.buy(farm.KIND_MAGNET());
        farm.claimBonus();
        assertEq(_player(alice).boostUntil, uint32(vm.getBlockNumber()) + farm.BOOST_BLOCKS() + farm.BOOST_PER_MAGNET());
        vm.stopPrank();
    }

    function test_BonusRequiresLiveRound() public {
        vm.prank(alice);
        vm.expectRevert(AuraFarm.RoundNotLive.selector);
        farm.claimBonus();
    }

    function test_NewRoundResetsUpgradesAndBonus() public {
        _start(0, 10, 20);
        _earn(alice, 200);
        vm.startPrank(alice);
        farm.buy(farm.KIND_MEGA());
        farm.claimBonus();
        vm.stopPrank();
        vm.roll(vm.getBlockNumber() + 10);

        _start(0, 100, 20);
        vm.prank(alice);
        farm.tap(1);
        AuraFarm.Player memory p = _player(alice);
        assertEq(p.mega, 0);
        assertEq(p.boostUntil, 0);
        assertEq(p.total, 1);
    }

    function test_RevertBadKind() public {
        _start(0, 100, 20);
        vm.prank(alice);
        vm.expectRevert(AuraFarm.BadKind.selector);
        farm.buy(9);
    }
}
