/**
 * Polymarket Data Fetcher — CRE HTTP Client
 *
 * Uses the standard CRE HTTPClient.sendRequest() pattern to fetch
 * events from the Polymarket Gamma API.
 */
import { type HTTPSendRequester } from "@chainlink/cre-sdk";
import { type Config } from "./config";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
export interface PolymarketEvent {
  id: string;
  question: string;
  description: string;
  options: string[];
  closed: boolean;
  volume: string;
}

// Raw shape from Gamma API
interface GammaMarket {
  groupItemTitle?: string;
  title?: string;
  question?: string;
}

interface GammaEvent {
  id?: string;
  title?: string;
  question?: string;
  description?: string;
  markets?: GammaMarket[];
  closed?: boolean;
  volume?: string;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function extractOptionsFromMarkets(markets?: GammaMarket[]): string[] {
  if (!Array.isArray(markets) || markets.length === 0) {
    return ["Yes", "No"];
  }
  return markets.map(
    (m) => m.groupItemTitle || m.title || m.question || "Unknown"
  );
}

function mapGammaEvent(item: GammaEvent): PolymarketEvent {
  return {
    id: item.id || "",
    question: item.title || item.question || "",
    description: item.description || "",
    options: extractOptionsFromMarkets(item.markets),
    closed: item.closed ?? true,
    volume: item.volume || "0",
  };
}

// ---------------------------------------------------------------------
// Fetch a list of historical events (used for frontend display)
// ---------------------------------------------------------------------
export const fetchHistoricalEvents = (
  sendRequester: HTTPSendRequester,
  config: Config
): PolymarketEvent[] => {
  const url = `${config.polymarketApiUrl}/events?closed=true&limit=10&order=volume&ascending=false`;

  const resp = sendRequester
    .sendRequest({
      url,
      method: "GET" as const,
      headers: {
        Authorization: `Bearer {{.polymarketApiKey}}`,
      },
    })
    .result();

  if (resp.statusCode !== 200) {
    throw new Error(`Polymarket API returned status ${resp.statusCode}`);
  }

  const bodyText = new TextDecoder().decode(resp.body);
  const data: GammaEvent[] = JSON.parse(bodyText);

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map(mapGammaEvent).slice(0, 10);
};

// ---------------------------------------------------------------------
// Fetch a single event by ID (used when EVM log trigger fires)
// ---------------------------------------------------------------------
export const fetchEventById = (
  sendRequester: HTTPSendRequester,
  config: Config,
  eventId: string
): PolymarketEvent => {
  const url = `${config.polymarketApiUrl}/events/${eventId}`;

  const resp = sendRequester
    .sendRequest({
      url,
      method: "GET" as const,
      headers: {
        Authorization: `Bearer {{.polymarketApiKey}}`,
      },
    })
    .result();

  if (resp.statusCode !== 200) {
    throw new Error(
      `Polymarket API returned status ${resp.statusCode} for event ${eventId}`
    );
  }

  const bodyText = new TextDecoder().decode(resp.body);
  const item: GammaEvent = JSON.parse(bodyText);

  return mapGammaEvent(item);
};
