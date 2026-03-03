/**
 * Consensus & On-Chain Execution — CRE EVM Client
 *
 * Vote-counting logic is unchanged. On-chain write uses the CRE SDK:
 *   encodeFunctionData() → runtime.report() → evmClient.writeReport()
 */
import {
    EVMClient,
    getNetwork,
    prepareReportRequest,
    bytesToHex,
    type Runtime,
} from "@chainlink/cre-sdk";
import { encodeFunctionData } from "viem";
import { type Config } from "./config";
import { type SwarmResult } from "./swarm";
import { OracleRegistryABI } from "./abi";

// ---------------------------------------------------------------------
// Consensus logic (pure vote-counting — no SDK dependency)
// ---------------------------------------------------------------------
export interface ConsensusResult {
    resolved: boolean;
    winningOption?: string;
    voteCounts: Record<string, number>;
    totalVotes: number;
}

/**
 * Calculates consensus using mode (most frequent selected_option).
 * Requires >50% majority to resolve.
 * Enforces a strict quorum: at least 3 successful responses required.
 */
export function calculateConsensus(results: SwarmResult[]): ConsensusResult {
    const successfulResults = results.filter((r) => r.success && r.data);

    if (successfulResults.length < 3) {
        return {
            resolved: false,
            voteCounts: {},
            totalVotes: successfulResults.length
        };
    }

    const voteCounts: Record<string, number> = {};
    successfulResults.forEach((r) => {
        const option = r.data!.selected_option;
        voteCounts[option] = (voteCounts[option] || 0) + 1;
    });

    const totalVotes = successfulResults.length;

    let maxVotes = 0;
    let winningOption: string | undefined;
    let isTied = false;

    for (const [option, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) {
            maxVotes = count;
            winningOption = option;
            isTied = false;
        } else if (count === maxVotes) {
            isTied = true;
        }
    }

    const majorityThreshold = totalVotes / 2;

    if (isTied || maxVotes <= majorityThreshold) {
        return { resolved: false, voteCounts, totalVotes };
    }

    return { resolved: true, winningOption, voteCounts, totalVotes };
}

// ---------------------------------------------------------------------
// On-chain execution via CRE EVM Client
// ---------------------------------------------------------------------

/**
 * Records a verdict on-chain using the CRE EVM Client.
 *
 * Pipeline: encodeFunctionData() → runtime.report() → evmClient.writeReport()
 *
 * The DON cryptographically signs the report, and the CRE network
 * submits the transaction to the OracleRegistry contract.
 */
export function executeOnChainResolution(
    runtime: Runtime<Config>,
    polymarketId: string,
    outcome: string
): void {
    const config = runtime.config;

    // 1. Resolve chain selector
    const network = getNetwork({
        chainFamily: "evm",
        chainSelectorName: config.chainSelectorName,
        isTestnet: config.isTestnet,
    });

    if (!network) {
        throw new Error(
            `Network not found for selector: ${config.chainSelectorName}`
        );
    }

    // 2. Encode the contract call
    const callData = encodeFunctionData({
        abi: OracleRegistryABI,
        functionName: "recordVerdict",
        args: [polymarketId, outcome],
    });

    // 3. Generate a DON-signed report
    const report = runtime
        .report(prepareReportRequest(callData))
        .result();

    // 4. Submit on-chain via the EVM Client
    const evmClient = new EVMClient(network.chainSelector.selector);

    const writeResult = evmClient
        .writeReport(runtime, {
            receiver: config.oracleRegistryAddress,
            report,
            gasConfig: { gasLimit: "500000" },
        })
        .result();

    runtime.log(
        `On-chain verdict recorded: tx=${bytesToHex(writeResult.txHash || new Uint8Array(32))}`
    );
}
