/**
 * SOPVault ABI in viem-compatible format.
 * Used by the CRE workflow to encode executeUMAVote calls
 * and decode UMAVoteCast events.
 */
export const SOPVaultABI = [
    {
        type: "function",
        name: "executeUMAVote",
        inputs: [
            { name: "polymarketId", type: "string" },
            { name: "verdict", type: "string" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "event",
        name: "UMAVoteCast",
        inputs: [
            { name: "polymarketId", type: "string", indexed: false },
            { name: "verdict", type: "string", indexed: false },
        ],
    },
] as const;
