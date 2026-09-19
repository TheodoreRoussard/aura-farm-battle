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

    function _player(address who) internal view returns (AuraFarm.Player memory p) {
        (p.total, p.spent, p.lastBlock, p.rate, p.power, p.round) = farm.players(who);
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
}
