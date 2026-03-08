// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SOPVault} from "../src/SOPVault.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

// Mock UMA Token
contract MockUMA is ERC20 {
    constructor() ERC20("UMA Token", "UMA") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SOPVaultTest is Test {
    SOPVault public vault;
    MockUMA public uma;

    address public creAddress = address(0xCCCC);
    address public nonCreAddress = address(0xDDDD);
    address public user1 = address(0x111);
    address public user2 = address(0x222);

    event UMAVoteCast(string polymarketId, string verdict);

    function setUp() public {
        uma = new MockUMA();
        vault = new SOPVault(address(uma), creAddress);

        uma.mint(user1, 1000 ether);
        uma.mint(user2, 1000 ether);
    }

    // ── Staking ──────────────────────────────────────────────────────

    function test_Stake() public {
        vm.startPrank(user1);
        uma.approve(address(vault), 100 ether);
        vault.stake(100 ether);
        vm.stopPrank();

        assertEq(vault.balances(user1), 100 ether);
        assertEq(vault.totalStaked(), 100 ether);
        assertEq(uma.balanceOf(address(vault)), 100 ether);
        assertEq(uma.balanceOf(user1), 900 ether);
    }

    function test_Unstake() public {
        vm.startPrank(user1);
        uma.approve(address(vault), 100 ether);
        vault.stake(100 ether);

        vault.unstake(50 ether);
        vm.stopPrank();

        assertEq(vault.balances(user1), 50 ether);
        assertEq(vault.totalStaked(), 50 ether);
        assertEq(uma.balanceOf(address(vault)), 50 ether);
        assertEq(uma.balanceOf(user1), 950 ether);
    }

    function test_Unstake_RevertInsufficientBalance() public {
        vm.startPrank(user1);
        uma.approve(address(vault), 100 ether);
        vault.stake(100 ether);

        vm.expectRevert("Insufficient staked balance");
        vault.unstake(150 ether);
        vm.stopPrank();
    }

    function test_TVL_and_APY() public {
        vm.startPrank(user1);
        uma.approve(address(vault), 100 ether);
        vault.stake(100 ether);
        vm.stopPrank();

        assertEq(vault.getUMATVL(), 100 ether);
        assertEq(vault.getAPY(), 500);
    }

    // ── CRE Integration ──────────────────────────────────────────────

    function test_InitialCREAddress() public view {
        assertEq(vault.creWorkflowAddress(), creAddress);
    }

    function test_ExecuteUMAVote_Success() public {
        vm.prank(creAddress);
        vm.expectEmit(false, false, false, true);
        emit UMAVoteCast("poly-123", "Yes");
        vault.executeUMAVote("poly-123", "Yes");
    }

    function test_ExecuteUMAVote_RevertIfNonCRE() public {
        vm.prank(nonCreAddress);
        vm.expectRevert("Only CRE workflow can call this");
        vault.executeUMAVote("poly-123", "Yes");
    }
}
