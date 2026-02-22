'use server';

const POLYMARKET_API_URL = "https://gamma-api.polymarket.com";

export interface Market {
    id: string;
    question: string;
    description: string;
    active: boolean;
    closed: boolean;
    volume: string;
    options: string[];
}

/**
 * Extracts outcome option names from an event's nested markets array.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractOptionsFromMarkets(markets: any[]): string[] {
    if (!Array.isArray(markets) || markets.length === 0) {
        return ['Yes', 'No'];
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return markets.map((m: any) => m.groupItemTitle || m.title || m.question || 'Unknown');
}

/**
 * Fetches closed, historically high-volume Polymarket events
 * sorted by volume descending — ideal as simulation targets.
 */
export async function fetchHistoricalMarkets(): Promise<Market[]> {
    try {
        const apiKey = process.env.POLYMARKET_API_KEY || '';

        const response = await fetch(
            `${POLYMARKET_API_URL}/events?closed=true&limit=10&order=volume&ascending=false`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                cache: 'no-store',
            }
        );

        if (!response.ok) {
            throw new Error(`Polymarket API responded with status: ${response.status}`);
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            return [];
        }

        // Map to a cleaner interface for the frontend components
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return data.map((item: any) => ({
            id: item.id || item.condition_id || Math.random().toString(),
            question: item.title || item.question || "Unknown Market",
            description: item.description || "No rules provided.",
            active: item.active ?? false,
            closed: item.closed ?? true,
            volume: item.volume !== undefined ? `$${Number(item.volume).toLocaleString()}` : "N/A",
            options: extractOptionsFromMarkets(item.markets),
        })).slice(0, 10);

    } catch (error) {
        console.error("Failed to fetch Polymarket historical markets:", error);
        return [];
    }
}

export async function getActiveModels(): Promise<{ name: string }[]> {
    // Read models from environment, filter empty, and cap at 4
    const potentialModels = [
        process.env.OPENAI_MODEL,
        process.env.ANTHROPIC_MODEL,
        process.env.GOOGLE_MODEL,
        process.env.DEEPSEEK_MODEL,
        process.env.ALIBABA_MODEL,
        process.env.XAI_MODEL
    ];

    const activeModels = potentialModels
        .filter((model): model is string => typeof model === 'string' && model.trim() !== '')
        .map(name => ({ name }));

    return activeModels.slice(0, 4);
}
