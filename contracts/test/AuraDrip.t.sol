// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {AuraDrip} from "../src/AuraDrip.sol";

contract AuraDripTest is Test {
    AuraDrip drip;
    address payable alice = payable(address(0xA11CE));
    address payable bob = payable(address(0xB0B));

    receive() external payable {}

    function setUp() public {
        drip = new AuraDrip{value: 1 ether}();
    }

    function _pair() internal view returns (address payable[] memory to) {
        to = new address payable[](2);
        to[0] = alice;
        to[1] = bob;
    }

    function test_DripFundsEveryRecipient() public {
        drip.drip(_pair(), 0.15 ether);
        assertEq(alice.balance, 0.15 ether);
        assertEq(bob.balance, 0.15 ether);
        assertEq(address(drip).balance, 0.7 ether);
    }

    function test_OnlyHost() public {
        vm.prank(alice);
        vm.expectRevert(AuraDrip.NotHost.selector);
        drip.drip(_pair(), 0.15 ether);
        vm.prank(alice);
        vm.expectRevert(AuraDrip.NotHost.selector);
        drip.withdraw();
    }

    function test_RevertsWhenEmpty() public {
        vm.expectRevert(AuraDrip.Empty.selector);
        drip.drip(_pair(), 0.6 ether);
    }

    function test_RefusingRecipientDoesNotBlockOthers() public {
        address payable[] memory to = _pair();
        to[0] = payable(address(new Refuser()));
        drip.drip(to, 0.15 ether);
        assertEq(bob.balance, 0.15 ether);
    }

    function test_WithdrawAndTopUp() public {
        uint256 before = address(this).balance;
        drip.withdraw();
        assertEq(address(this).balance, before + 1 ether);
        (bool ok,) = address(drip).call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(address(drip).balance, 0.5 ether);
    }
}

contract Refuser {
    receive() external payable {
        revert();
    }
}
