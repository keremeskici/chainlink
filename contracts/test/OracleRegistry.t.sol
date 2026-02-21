// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OracleRegistry} from "../src/OracleRegistry.sol";

contract OracleRegistryTest is Test {
    OracleRegistry public registry;
    address public creAddress = address(0x123);
    address public nonCreAddress = address(0x456);
    address public user = address(0x789);

    event ResolutionRequested(string polymarketId, address requester);
    event VerdictRecorded(string indexed polymarketId, string outcome);

    function setUp() public {
        registry = new OracleRegistry(creAddress);
    }

    function test_InitialState() public view {
        assertEq(registry.creWorkflowAddress(), creAddress);
    }

    // ── requestResolution ────────────────────────────────────────────

    function test_RequestResolution_EmitsEvent() public {
        vm.prank(user);
        vm.expectEmit(false, false, false, true);
        emit ResolutionRequested("poly-123", user);
        registry.requestResolution("poly-123");
    }

    function test_RequestResolution_RevertIfAlreadyRecorded() public {
        // First record a verdict
        vm.prank(creAddress);
        registry.recordVerdict("poly-123", "Candidate A");

        // Then try to request resolution for it
        vm.prank(user);
        vm.expectRevert("Verdict already recorded for this market");
        registry.requestResolution("poly-123");
    }

    // ── recordVerdict ────────────────────────────────────────────────

    function test_RecordVerdict_Success() public {
        vm.prank(creAddress);
        registry.recordVerdict("poly-123", "Candidate A");

        (
            string memory polymarketId,
            string memory outcome,
            uint256 timestamp
        ) = registry.resolutions("poly-123");
        assertEq(polymarketId, "poly-123");
        assertEq(outcome, "Candidate A");
        assertGt(timestamp, 0);
    }

    function test_RecordVerdict_MultiOutcome() public {
        vm.prank(creAddress);
        registry.recordVerdict("election-2024", "Donald Trump");

        (, string memory outcome, ) = registry.resolutions("election-2024");
        assertEq(outcome, "Donald Trump");
    }

    function test_RecordVerdict_RevertIfNonCRE() public {
        vm.prank(nonCreAddress);
        vm.expectRevert("Only CRE workflow can call this");
        registry.recordVerdict("poly-123", "Candidate A");
    }

    function test_RecordVerdict_RevertIfAlreadyRecorded() public {
        vm.prank(creAddress);
        registry.recordVerdict("poly-123", "Candidate A");

        vm.prank(creAddress);
        vm.expectRevert("Verdict already recorded");
        registry.recordVerdict("poly-123", "Candidate B");
    }
}
