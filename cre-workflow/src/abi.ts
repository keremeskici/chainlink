/**
 * OracleRegistry ABI in viem-compatible format.
 * Used by both CRE workflow (encodeFunctionData, decodeEventLog)
 * and for EVM Log Trigger event signature hashing.
 */
export const OracleRegistryABI = [
    {
        type: "function",
        name: "requestResolution",
        inputs: [{ name: "_polymarketId", type: "string" }],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "recordVerdict",
        inputs: [
            { name: "_polymarketId", type: "string" },
            { name: "_outcome", type: "string" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "event",
        name: "ResolutionRequested",
        inputs: [
            { name: "polymarketId", type: "string", indexed: false },
            { name: "requester", type: "address", indexed: false },
        ],
    },
    {
        type: "event",
        name: "VerdictRecorded",
        inputs: [
            { name: "polymarketId", type: "string", indexed: true },
            { name: "outcome", type: "string", indexed: false },
        ],
    },
] as const;
