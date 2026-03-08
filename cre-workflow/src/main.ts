/**
 * SwarmOracle Protocol — CRE Workflow Entry Point
 *
 * Event-driven: fires when UMAVoteCast or a trigger is emitted on SOPVault.
 *
 *   1. Decode polymarketId from the EVM log
 *   2. Fetch that specific event from Polymarket (HTTP Client)
 *   3. Run AI swarm consensus (Confidential HTTP Client)
 *   4. Write verdict on-chain via SOPVault.executeUMAVote (EVM Client)
 *
 * Run: cre workflow simulate .
 */
import {
    EVMClient,
    HTTPClient,
    handler,
    getNetwork,
    hexToBase64,
    bytesToHex,
    consensusIdenticalAggregation,
    type Runtime,
    type EVMLog,
    Runner,
} from "@chainlink/cre-sdk";
import { keccak256, toBytes, decodeAbiParameters } from "viem";
import { configSchema, type Config } from "./config";
import { fetchEventById, type PolymarketEvent } from "./polymarket";
import { executeSwarm, type SwarmOutput } from "./swarm";
import { calculateConsensus, executeOnChainResolution } from "./consensus";

// ---------------------------------------------------------------------
// Log decoding helper
// ---------------------------------------------------------------------

/**
 * Decodes the polymarketId from ResolutionRequested event log.data.
 *
 * ResolutionRequested(string polymarketId, address requester)
 * Both params are non-indexed, so they are ABI-encoded in log.data.
 */
function decodeResolutionRequestedLog(log: EVMLog): string {
    const dataHex = `0x${Buffer.from(log.data).toString("hex")}` as `0x${string}`;

    const decoded = decodeAbiParameters(
        [
            { name: "polymarketId", type: "string" },
            { name: "requester", type: "address" },
        ],
        dataHex
    );

    return decoded[0]; // polymarketId
}

// ---------------------------------------------------------------------
// Main workflow handler — triggered by ResolutionRequested log
// ---------------------------------------------------------------------
const onLogTrigger = (runtime: Runtime<Config>, log: EVMLog): string => {
    const config = runtime.config;

    // Step 1: Decode the polymarketId from the emitted log
    const polymarketId = decodeResolutionRequestedLog(log);
    const txHash = bytesToHex(log.txHash);

    runtime.log(
        `ResolutionRequested received: polymarketId="${polymarketId}" tx=${txHash}`
    );

    // Step 2: Fetch this specific event from Polymarket via standard HTTP
    runtime.log(`Fetching Polymarket event ${polymarketId}...`);
    type EventResult = { event: PolymarketEvent };

    const httpClient = new HTTPClient();
    const eventResult = httpClient
        .sendRequest(
            runtime,
            (sendRequester, cfg: Config): EventResult => ({
                event: fetchEventById(sendRequester, cfg, polymarketId),
            }),
            consensusIdenticalAggregation<EventResult>()
        )(config)
        .result();

    const event = eventResult.event;
    runtime.log(
        `Event fetched: "${event.question}" (${event.options.length} options)`
    );

    // Step 3: Execute AI swarm via Confidential HTTP
    runtime.log("Initiating AI swarm consensus via Confidential HTTP...");
    const swarmOutput = executeSwarm(runtime, config, event);

    // Log individual results
    for (const result of swarmOutput.results) {
        if (result.success) {
            runtime.log(
                `${result.providerName}: "${result.data!.selected_option}" — ${result.data!.reasoning.slice(0, 100)}...`
            );
        } else {
            runtime.log(`${result.providerName}: FAILED — ${result.error}`);
        }
    }

    // Step 4: Calculate consensus
    runtime.log("Calculating consensus...");
    const consensus = calculateConsensus(swarmOutput.results);

    if (!consensus.resolved) {
        runtime.log(
            `Consensus NOT reached. Votes: ${JSON.stringify(consensus.voteCounts)}`
        );
        return "NO_CONSENSUS";
    }

    runtime.log(
        `Consensus reached: "${consensus.winningOption}" (${consensus.totalVotes} votes: ${JSON.stringify(consensus.voteCounts)})`
    );

    // Step 5: Write verdict on-chain via SOPVault.executeUMAVote
    runtime.log(
        `Recording verdict on SOPVault: ${polymarketId} → "${consensus.winningOption}"`
    );
    executeOnChainResolution(runtime, polymarketId, consensus.winningOption!);
    runtime.log("On-chain transaction confirmed via SOPVault.");

    return `RESOLVED:${consensus.winningOption}`;
};

// ---------------------------------------------------------------------
// Workflow initialization — EVM Log Trigger on SOPVault
// ---------------------------------------------------------------------
const initWorkflow = (config: Config) => {
    const network = getNetwork({
        chainFamily: "evm",
        chainSelectorName: config.chainSelectorName,
        isTestnet: config.isTestnet,
    });

    if (!network) {
        throw new Error(
            `Network not found: ${config.chainSelectorName}`
        );
    }

    const evmClient = new EVMClient(network.chainSelector.selector);

    // Watch for ResolutionRequested(string,address) on SOPVault
    const eventSignature = keccak256(
        toBytes("ResolutionRequested(string,address)")
    );

    const logTrigger = evmClient.logTrigger({
        addresses: [hexToBase64(config.sopVaultAddress as `0x${string}`)],
        topics: [
            { values: [hexToBase64(eventSignature)] },
        ],
    });

    return [handler(logTrigger, onLogTrigger)];
};

export async function main() {
    const runner = await Runner.newRunner<Config>({ configSchema });
    await runner.run(initWorkflow);
}
