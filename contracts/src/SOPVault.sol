// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

contract SOPVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable umaToken;
    address public creWorkflowAddress;

    mapping(address => uint256) public balances;
    uint256 public totalStaked;

    uint256 public constant MOCK_APY = 500; // 5% APY (in basis points)

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event UMAVoteCast(string polymarketId, string verdict);

    modifier onlyCRE() {
        require(
            msg.sender == creWorkflowAddress,
            "Only CRE workflow can call this"
        );
        _;
    }

    constructor(address _umaToken, address _creWorkflowAddress) {
        require(_umaToken != address(0), "Invalid token address");
        require(_creWorkflowAddress != address(0), "Invalid CRE address");
        umaToken = IERC20(_umaToken);
        creWorkflowAddress = _creWorkflowAddress;
    }

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake 0");

        umaToken.safeTransferFrom(msg.sender, address(this), amount);

        balances[msg.sender] += amount;
        totalStaked += amount;

        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot unstake 0");
        require(balances[msg.sender] >= amount, "Insufficient staked balance");

        balances[msg.sender] -= amount;
        totalStaked -= amount;

        umaToken.safeTransfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount);
    }

    /// @notice CRE-only: execute a UMA vote on behalf of the vault's delegators.
    function executeUMAVote(
        string memory polymarketId,
        string memory verdict
    ) external onlyCRE {
        emit UMAVoteCast(polymarketId, verdict);
    }

    /// @notice Returns the Total Value Locked (TVL) in the vault
    function getUMATVL() external view returns (uint256) {
        return totalStaked;
    }

    /// @notice Returns the mock APY
    function getAPY() external pure returns (uint256) {
        return MOCK_APY;
    }
}
