// @ts-nocheck — Placeholder module, not compiled in production
/**
 * UMA VotingV2 Commit-Reveal Voter
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  PLACEHOLDER MODULE — NOT USED IN DEMO                            │
 * │                                                                    │
 * │  This module implements the full UMA VotingV2 commit-reveal flow  │
 * │  for casting votes on resolved prediction markets. It is designed │
 * │  to be called AFTER the AI swarm consensus is reached.            │
 * │                                                                    │
 * │  Flow:                                                             │
 * │    1. Approve UMA token spending on VotingV2 contract              │
 * │    2. Stake UMA tokens (required to vote)                          │
 * │    3. Wait for Commit phase                                        │
 * │    4. Commit hashed vote (price + salt + voter + metadata)         │
 * │    5. Wait for Reveal phase                                        │
 * │    6. Reveal vote with original values                             │
 * │                                                                    │
 * │  To activate: import and call executeUMAVote() after consensus.    │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import {
    createPublicClient,
    createWalletClient,
    http,
    encodePacked,
    keccak256,
    encodeAbiParameters,
    parseAbiParameters,
    parseAbi,
    type Address,
    type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

// ─── Contract ABIs (minimal, only the functions we need) ────────────

const ERC20_ABI = parseAbi([
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
]);

const VOTING_V2_ABI = parseAbi([
    // Phase & round info
    "function getVotePhase() external view returns (uint8)",
    "function getCurrentRoundId() external view returns (uint32)",
    "function getRoundEndTime(uint256 roundId) external view returns (uint256)",

    // Staking
    "function stake(uint128 amount) external",
    "function requestUnstake(uint128 amount) external",

    // Commit-Reveal voting
    "function commitVote(bytes32 identifier, uint256 time, bytes ancillaryData, bytes32 hash) external",
    "function revealVote(bytes32 identifier, uint256 time, int256 price, bytes ancillaryData, int256 salt) external",

    // Queries
    "function hasPrice(bytes32 identifier, uint256 time, bytes ancillaryData) external view returns (bool)",
    "function getPrice(bytes32 identifier, uint256 time, bytes ancillaryData) external view returns (int256)",
    "function getPendingRequests() external view returns ((uint32 lastVotingRound, bool isGovernance, uint64 time, uint32 rollCount, bytes32 identifier, bytes ancillaryData)[])",

    // Voter info
    "function voterStakes(address) external view returns (uint128 stake, uint128 pendingUnstake, uint128 rewardsPaidPerToken, uint128 outstandingRewards, int128 unappliedSlash, uint64 nextIndexToProcess, uint64 unstakeTime, address delegate)",
]);

// ─── Configuration ──────────────────────────────────────────────────

interface UMAVoteConfig {
    rpcUrl: string;
    privateKey: Hex;
    votingV2Address: Address;
    umaTokenAddress: Address;
    chainId: number;
}

function loadConfig(): UMAVoteConfig {
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
    const privateKey = process.env.PRIVATE_KEY as Hex;

    if (!rpcUrl) throw new Error("Missing NEXT_PUBLIC_RPC_URL in .env");
    if (!privateKey) throw new Error("Missing PRIVATE_KEY in .env");

    return {
        rpcUrl,
        privateKey,
        // UMA VotingV2 on Ethereum mainnet — update these for your target network
        votingV2Address: "0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac" as Address,
        umaTokenAddress: "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828" as Address,
        chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 1,
    };
}

// ─── Voting phases (from VotingV2 contract) ─────────────────────────

enum VotePhase {
    Commit = 0,
    Reveal = 1,
}

// ─── Core types ─────────────────────────────────────────────────────

interface VoteParams {
    /** The identifier for the price request (bytes32) */
    identifier: Hex;
    /** Unix timestamp of the price request */
    time: bigint;
    /** Ancillary data for the request */
    ancillaryData: Hex;
    /** The resolved price to vote for (as int256, e.g. 1e18 for YES) */
    price: bigint;
}

interface VoteResult {
    commitTxHash: Hex;
    revealTxHash: Hex;
    roundId: number;
    votedPrice: bigint;
}

// ─── Helper: generate a cryptographically random salt ───────────────

function generateSalt(): bigint {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return BigInt(
        "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
    );
}

// ─── Helper: compute the commit hash ────────────────────────────────
/**
 * Replicates the Solidity check in revealVote():
 *   keccak256(abi.encodePacked(price, salt, voter, time, ancillaryData, uint256(currentRoundId), identifier))
 */
function computeCommitHash(
    price: bigint,
    salt: bigint,
    voter: Address,
    time: bigint,
    ancillaryData: Hex,
    roundId: number,
    identifier: Hex
): Hex {
    return keccak256(
        encodePacked(
            ["int256", "int256", "address", "uint256", "bytes", "uint256", "bytes32"],
            [price, salt, voter, time, ancillaryData, BigInt(roundId), identifier]
        )
    );
}

// ─── Helper: encode a string as bytes32 identifier ──────────────────

function stringToBytes32(str: string): Hex {
    const encoded = encodeAbiParameters(
        parseAbiParameters("bytes32"),
        [("0x" + Buffer.from(str).toString("hex").padEnd(64, "0")) as Hex]
    );
    // encodeAbiParameters returns abi-encoded, we just need the raw bytes32
    return ("0x" + Buffer.from(str).toString("hex").padEnd(64, "0")) as Hex;
}

// ─── Step 1: Ensure UMA token allowance ─────────────────────────────

async function ensureAllowance(
    config: UMAVoteConfig,
    stakeAmount: bigint
): Promise<Hex | null> {
    const account = privateKeyToAccount(config.privateKey);

    const publicClient = createPublicClient({
        chain: arbitrumSepolia,
        transport: http(config.rpcUrl),
    });

    const walletClient = createWalletClient({
        account,
        chain: arbitrumSepolia,
        transport: http(config.rpcUrl),
    });

    // Check current allowance
    const currentAllowance = await publicClient.readContract({
        address: config.umaTokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account.address, config.votingV2Address],
    });

    console.log(`[UMA Voter] Current allowance: ${currentAllowance}`);

    if (currentAllowance >= stakeAmount) {
        console.log("[UMA Voter] Allowance sufficient, skipping approval");
        return null;
    }

    // Approve max uint256 for convenience (one-time unlimited approval)
    const maxApproval = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

    console.log("[UMA Voter] Approving UMA token spending...");
    const txHash = await walletClient.writeContract({
        address: config.umaTokenAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [config.votingV2Address, maxApproval],
    });

    console.log(`[UMA Voter] Approval TX: ${txHash}`);

    // Wait for confirmation
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log("[UMA Voter] Approval confirmed");

    return txHash;
}

// ─── Step 2: Stake UMA tokens ───────────────────────────────────────

async function stakeTokens(
    config: UMAVoteConfig,
    amount: bigint
): Promise<Hex> {
    const account = privateKeyToAccount(config.privateKey);

    const walletClient = createWalletClient({
        account,
        chain: arbitrumSepolia,
        transport: http(config.rpcUrl),
    });

    const publicClient = createPublicClient({
        chain: arbitrumSepolia,
        transport: http(config.rpcUrl),
    });

    // Check current stake
    const voterStake = await publicClient.readContract({
        address: config.votingV2Address,
        abi: VOTING_V2_ABI,
        functionName: "voterStakes",
        args: [account.address],
    });

    const currentStake = voterStake[0]; // first element is stake amount
    console.log(`[UMA Voter] Current stake: ${currentStake}`);

    if (currentStake >= amount) {
        console.log("[UMA Voter] Already staked enough, skipping");
        return "0x0" as Hex;
    }

    const toStake = amount - currentStake;
    console.log(`[UMA Voter] Staking ${toStake} UMA tokens...`);

    const txHash = await walletClient.writeContract({
        address: config.votingV2Address,
        abi: VOTING_V2_ABI,
        functionName: "stake",
        args: [BigInt(toStake) as unknown as number], // uint128
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[UMA Voter] Stake confirmed: ${txHash}`);

    return txHash;
}

// ─── Step 3: Wait for a specific vote phase ─────────────────────────

async function waitForPhase(
    config: UMAVoteConfig,
    targetPhase: VotePhase,
    maxWaitMs: number = 300_000 // 5 minutes default
): Promise<number> {
    const publicClient = createPublicClient({
        chain: arbitrumSepolia,
        transport: http(config.rpcUrl),
    });

    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        const currentPhase = await publicClient.readContract({
            address: config.votingV2Address,
            abi: VOTING_V2_ABI,
            functionName: "getVotePhase",
        });

        const roundId = await publicClient.readContract({
            address: config.votingV2Address,
            abi: VOTING_V2_ABI,
            functionName: "getCurrentRoundId",
        });

        if (Number(currentPhase) === targetPhase) {
            console.log(
                `[UMA Voter] In ${targetPhase === VotePhase.Commit ? "Commit" : "Reveal"} phase, round ${roundId}`
            );
            return Number(roundId);
        }

        console.log(
            `[UMA Voter] Waiting for ${targetPhase === VotePhase.Commit ? "Commit" : "Reveal"} phase... ` +
            `(currently: ${Number(currentPhase) === 0 ? "Commit" : "Reveal"}, round ${roundId})`
        );

        // Poll every 30 seconds
        await new Promise((r) => setTimeout(r, 30_000));
    }

    throw new Error(`[UMA Voter] Timed out waiting for phase ${targetPhase}`);
}

// ─── Step 4: Commit vote ────────────────────────────────────────────

async function commitVote(
    config: UMAVoteConfig,
    vote: VoteParams,
    salt: bigint
): Promise<{ txHash: Hex; roundId: number }> {
    const account = privateKeyToAccount(config.privateKey);

    const publicClient = createPublicClient({
        chain: arbitrumSepolia,
        transport: http(config.rpcUrl),
    });

    const walletClient = createWalletClient({
        account,
        chain: arbitrumSepolia,
        transport: http(config.rpcUrl),
    });

    // Wait for commit phase
    const roundId = await waitForPhase(config, VotePhase.Commit);

    // Compute the commit hash exactly as VotingV2 expects
    const commitHash = computeCommitHash(
        vote.price,
        salt,
        account.address,
        vote.time,
        vote.ancillaryData,
        roundId,
        vote.identifier
    );

    console.log(`[UMA Voter] Committing vote...`);
    console.log(`  Identifier: ${vote.identifier}`);
    console.log(`  Time: ${vote.time}`);
    console.log(`  Price: ${vote.price}`);
    console.log(`  Round: ${roundId}`);
    console.log(`  Hash: ${commitHash}`);

    const txHash = await walletClient.writeContract({
        address: config.votingV2Address,
        abi: VOTING_V2_ABI,
        functionName: "commitVote",
        args: [vote.identifier, vote.time, vote.ancillaryData, commitHash],
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[UMA Voter] Commit confirmed: ${txHash}`);

    return { txHash, roundId };
}

// ─── Step 5: Reveal vote ────────────────────────────────────────────

async function revealVote(
    config: UMAVoteConfig,
    vote: VoteParams,
    salt: bigint
): Promise<Hex> {
    const account = privateKeyToAccount(config.privateKey);

    const publicClient = createPublicClient({
        chain: arbitrumSepolia,
        transport: http(config.rpcUrl),
    });

    const walletClient = createWalletClient({
        account,
        chain: arbitrumSepolia,
        transport: http(config.rpcUrl),
    });

    // Wait for reveal phase
    await waitForPhase(config, VotePhase.Reveal);

    console.log(`[UMA Voter] Revealing vote...`);
    console.log(`  Price: ${vote.price}`);
    console.log(`  Salt: ${salt}`);

    const txHash = await walletClient.writeContract({
        address: config.votingV2Address,
        abi: VOTING_V2_ABI,
        functionName: "revealVote",
        args: [vote.identifier, vote.time, vote.price, vote.ancillaryData, salt],
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[UMA Voter] Reveal confirmed: ${txHash}`);

    return txHash;
}

// ─── Main entry point ───────────────────────────────────────────────

/**
 * Execute the full UMA VotingV2 commit-reveal vote flow.
 *
 * Called after AI swarm consensus is reached. Encodes the consensus
 * outcome as a price (1e18 = YES, 0 = NO) and casts it through
 * UMA's commit-reveal Schelling scheme.
 *
 * @param identifier - The price request identifier (e.g. "SOP_RESOLUTION")
 * @param time       - The timestamp of the price request
 * @param ancillaryData - Additional context (e.g. polymarketId)
 * @param consensusOutcome - The consensus winner string from the AI swarm
 * @param stakeAmount - Amount of UMA tokens to stake (in wei)
 *
 * @returns VoteResult with both commit and reveal tx hashes
 */
export async function executeUMAVote(
    identifier: string,
    time: bigint,
    ancillaryData: string,
    consensusOutcome: string,
    stakeAmount: bigint = BigInt("1000000000000000000") // 1 UMA default
): Promise<VoteResult> {
    const config = loadConfig();

    console.log("╔════════════════════════════════════════════════╗");
    console.log("║       UMA VOTINGV2 — COMMIT-REVEAL VOTE       ║");
    console.log("╚════════════════════════════════════════════════╝");
    console.log(`  Outcome: ${consensusOutcome}`);
    console.log(`  Identifier: ${identifier}`);
    console.log(`  Stake amount: ${stakeAmount}`);
    console.log();

    // Encode the consensus outcome as a price
    // Convention: use keccak256 of the outcome string as the int256 price
    // This allows any string outcome to be voted on, not just YES/NO
    const priceHash = keccak256(
        encodeAbiParameters(parseAbiParameters("string"), [consensusOutcome])
    );
    const price = BigInt(priceHash); // Convert bytes32 hash to int256

    const identifierBytes32 = stringToBytes32(identifier);
    const ancillaryDataHex = ("0x" +
        Buffer.from(ancillaryData).toString("hex")) as Hex;

    const vote: VoteParams = {
        identifier: identifierBytes32,
        time,
        ancillaryData: ancillaryDataHex,
        price,
    };

    // Generate a random salt for this vote
    const salt = generateSalt();

    // Step 1: Ensure UMA token allowance
    console.log("[Step 1/5] Checking UMA token allowance...");
    await ensureAllowance(config, stakeAmount);

    // Step 2: Stake UMA tokens
    console.log("[Step 2/5] Staking UMA tokens...");
    await stakeTokens(config, stakeAmount);

    // Step 3-4: Commit vote (waits for commit phase internally)
    console.log("[Step 3/5] Waiting for commit phase...");
    console.log("[Step 4/5] Committing vote...");
    const { txHash: commitTxHash, roundId } = await commitVote(
        config,
        vote,
        salt
    );

    // Step 5: Reveal vote (waits for reveal phase internally)
    console.log("[Step 5/5] Waiting for reveal phase & revealing...");
    const revealTxHash = await revealVote(config, vote, salt);

    console.log();
    console.log("╔════════════════════════════════════════════════╗");
    console.log("║              VOTE COMPLETE                     ║");
    console.log("╚════════════════════════════════════════════════╝");
    console.log(`  Commit TX: ${commitTxHash}`);
    console.log(`  Reveal TX: ${revealTxHash}`);
    console.log(`  Round ID:  ${roundId}`);
    console.log(`  Price:     ${price}`);
    console.log();

    return {
        commitTxHash,
        revealTxHash,
        roundId,
        votedPrice: price,
    };
}

// ─── Standalone test runner (not used in production) ────────────────
// Uncomment to test directly: npx tsx src/uma_voter.ts

// async function main() {
//     const result = await executeUMAVote(
//         "SOP_RESOLUTION",              // identifier
//         BigInt(Math.floor(Date.now() / 1000)),  // current time
//         "polymarket:903193",           // ancillary data (polymarket ID)
//         "Donald Trump",                // consensus outcome
//         BigInt("1000000000000000000")  // 1 UMA
//     );
//     console.log("Result:", result);
// }
// main().catch(console.error);
