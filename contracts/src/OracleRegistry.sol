// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract OracleRegistry {
    address public creWorkflowAddress;

    struct Resolution {
        string polymarketId;
        string outcome;
        uint256 timestamp;
    }

    mapping(string => Resolution) public resolutions;

    event ResolutionRequested(string polymarketId, address requester);
    event VerdictRecorded(string indexed polymarketId, string outcome);

    modifier onlyCRE() {
        _onlyCRE();
        _;
    }

    function _onlyCRE() internal view {
        require(
            msg.sender == creWorkflowAddress,
            "Only CRE workflow can call this"
        );
    }

    constructor(address _creWorkflowAddress) {
        require(_creWorkflowAddress != address(0), "Invalid CRE address");
        creWorkflowAddress = _creWorkflowAddress;
    }

    /**
     * @notice User-facing: request the CRE workflow to resolve a market.
     * Emits ResolutionRequested which the CRE EVM Log Trigger watches.
     */
    function requestResolution(string memory _polymarketId) external {
        require(
            resolutions[_polymarketId].timestamp == 0,
            "Verdict already recorded for this market"
        );

        emit ResolutionRequested(_polymarketId, msg.sender);
    }

    /**
     * @notice CRE-only: record the final verdict after AI swarm consensus.
     */
    function recordVerdict(
        string memory _polymarketId,
        string memory _outcome
    ) external onlyCRE {
        require(
            resolutions[_polymarketId].timestamp == 0,
            "Verdict already recorded"
        );

        resolutions[_polymarketId] = Resolution({
            polymarketId: _polymarketId,
            outcome: _outcome,
            timestamp: block.timestamp
        });

        emit VerdictRecorded(_polymarketId, _outcome);
    }
}
