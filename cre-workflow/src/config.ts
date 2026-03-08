/**
 * CRE Workflow Configuration
 *
 * Replaces dotenv/process.env with a zod-validated config schema.
 * Config values are injected by the CRE runtime from config.json.
 */
import { z } from "zod";

// ---------------------------------------------------------------------
// Config Schema — validated at runner startup
// ---------------------------------------------------------------------
export const configSchema = z.object({
    polymarketApiUrl: z.string(),
    sopVaultAddress: z.string(),
    chainSelectorName: z.string(),
    isTestnet: z.boolean(),
    owner: z.string(),

    // Dynamic Search configuration
    useDynamicSearch: z.boolean(),

    // AI model identifiers — leave empty string to disable a provider
    openaiModel: z.string(),
    anthropicModel: z.string(),
    googleModel: z.string(),
    deepseekModel: z.string(),
});

export type Config = z.infer<typeof configSchema>;

// ---------------------------------------------------------------------
// AI Provider Registry
// ---------------------------------------------------------------------
export interface ProviderSpec {
    name: string;
    /** Config field holding the model name */
    modelField: keyof Config;
    /** Vault DON secret key for the API key (maps to secrets.yaml) */
    secretKey: string;
    /** Provider API endpoint */
    endpoint: string;
    /** True if this provider uses the OpenAI-compatible /chat/completions API */
    isOpenAICompatible: boolean;
}

/**
 * Static registry of all supported AI providers.
 * At runtime, we filter down to only those with non-empty model fields.
 */
export const AI_PROVIDERS: ProviderSpec[] = [
    {
        name: "OpenAI",
        modelField: "openaiModel",
        secretKey: "openaiApiKey",
        endpoint: "https://api.openai.com/v1/chat/completions",
        isOpenAICompatible: true,
    },
    {
        name: "Anthropic",
        modelField: "anthropicModel",
        secretKey: "anthropicApiKey",
        endpoint: "https://api.anthropic.com/v1/messages",
        isOpenAICompatible: false,
    },
    {
        name: "Google",
        modelField: "googleModel",
        secretKey: "googleApiKey",
        endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
        isOpenAICompatible: false,
    },
    {
        name: "DeepSeek",
        modelField: "deepseekModel",
        secretKey: "deepseekApiKey",
        endpoint: "https://api.deepseek.com/chat/completions",
        isOpenAICompatible: true,
    },
];

/**
 * Returns active providers based on which model fields are non-empty in config.
 * Capped at 4 concurrent models per PRD spec.
 */
export function getActiveProviders(config: Config): ProviderSpec[] {
    return AI_PROVIDERS.filter(
        (p) => (config[p.modelField] as string).trim() !== ""
    ).slice(0, 4);
}
