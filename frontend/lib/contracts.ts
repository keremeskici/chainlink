import { parseAbi } from "viem";

export const SOP_VAULT_ADDRESS = process.env.NEXT_PUBLIC_SOP_VAULT as `0x${string}`;
export const ORACLE_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_ORACLE_REGISTRY as `0x${string}`;

export const SOP_VAULT_ABI = parseAbi([
    "function stake(uint256 amount) external",
    "function unstake(uint256 amount) external",
    "function getUmatvl() external view returns (uint256)",
    "function getApy() external pure returns (uint256)",
    "function balances(address user) external view returns (uint256)",
    "function umaToken() external view returns (address)"
]);

export const ORACLE_REGISTRY_ABI = parseAbi([
    "function requestResolution(string memory _polymarketId) external",
    "function recordVerdict(string memory _polymarketId, string memory _outcome) external",
    "function resolutions(string memory) external view returns (string polymarketId, string outcome, uint256 timestamp)",
    "event ResolutionRequested(string polymarketId, address requester)",
    "event VerdictRecorded(string indexed polymarketId, string outcome)"
]);

// Since SOPVault accepts UMA token deposits, we need the standard ERC20 ABI
// to trigger the approval step before calling stake()
export const ERC20_ABI = parseAbi([
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)"
]);
