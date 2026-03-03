/**
 * News Context Fetcher — CRE HTTP Client (Non-Confidential)
 *
 * Uses the standard CRE HTTPClient.sendRequest() pattern to fetch
 * news articles from verified outlets. These articles provide factual
 * context for AI consensus agents when resolving prediction markets.
 *
 * Follows the same pattern as polymarket.ts — compatible with DON
 * consensus validation in production.
 */
import { type HTTPSendRequester, ConfidentialHTTPClient, ok, json, type Runtime } from "@chainlink/cre-sdk";
import { type Config } from "./config";
import { type PolymarketEvent } from "./polymarket";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
export interface NewsSource {
    name: string;
    url: string;
    content: string;
}

export interface NewsContext {
    fetchedAt: string;
    sources: NewsSource[];
}

// ---------------------------------------------------------------------
// News outlet configuration
// ---------------------------------------------------------------------
const NEWS_OUTLETS = [
    {
        name: "DW News",
        url: "https://www.dw.com/en/us-presidential-election-2024/t-65733013",
    },
    {
        name: "CNN",
        url: "https://edition.cnn.com/election/2024/results/president?election-data-id=2024-PG&election-painting-mode=projection-with-lead&filter-key-races=false&filter-flipped=false&filter-remaining=false",
    },
    {
        name: "BBC",
        url: "https://www.bbc.com/news/election/2024/us/results",
    },
];

// Maximum characters to keep per source (to stay within LLM token limits)
const MAX_CONTENT_LENGTH = 8000;

// ---------------------------------------------------------------------
// HTML text extraction helper
// ---------------------------------------------------------------------
function stripHtmlTags(html: string): string {
    // Remove script and style blocks entirely
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    // Remove all HTML tags
    text = text.replace(/<[^>]+>/g, " ");
    // Decode common HTML entities
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, " ");
    // Collapse multiple whitespace/newlines
    text = text.replace(/\s+/g, " ").trim();
    return text;
}

// ---------------------------------------------------------------------
// CRE-compatible news fetcher
// ---------------------------------------------------------------------

/**
 * Fetches news context from verified outlets using the CRE HTTP Client.
 * Each request goes through the DON consensus layer in production.
 *
 * Usage in main.ts:
 *   const httpClient = new HTTPClient();
 *   const newsResult = httpClient.sendRequest(
 *     runtime,
 *     (sendRequester, cfg) => ({ news: fetchNewsContext(runtime, sendRequester, cfg) }),
 *     consensusIdenticalAggregation<{ news: NewsContext }>()
 *   )(config).result();
 */
export const fetchNewsContext = (
    runtime: Runtime<unknown>,
    sendRequester: HTTPSendRequester,
    config: Config,
    event?: PolymarketEvent
): NewsContext => {
    if (config.useDynamicSearch && event) {
        const dynamicContext = fetchDynamicNewsContext(runtime, sendRequester, event);
        // Fallback if dynamic search fails to retrieve valid URLs
        if (dynamicContext.sources.length === 0 || dynamicContext.sources[0].name.includes("Error")) {
            runtime.log("Dynamic search failed or missing API key, falling back to hardcoded news outlets.");
            return fetchHardcodedNewsContext(sendRequester);
        }
        return dynamicContext;
    }
    return fetchHardcodedNewsContext(sendRequester);
};

function fetchHardcodedNewsContext(sendRequester: HTTPSendRequester): NewsContext {
    const sources: NewsSource[] = [];

    for (const outlet of NEWS_OUTLETS) {
        try {
            const resp = sendRequester
                .sendRequest({
                    url: outlet.url,
                    method: "GET" as const,
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (compatible; ChainlinkCRE/1.0)",
                        Accept: "text/html,application/xhtml+xml,*/*",
                    },
                })
                .result();

            if (resp.statusCode !== 200) {
                sources.push({
                    name: outlet.name,
                    url: outlet.url,
                    content: `[ERROR: HTTP ${resp.statusCode}]`,
                });
                continue;
            }

            const bodyText = new TextDecoder().decode(resp.body);
            const cleanText = stripHtmlTags(bodyText);
            const truncated = cleanText.slice(0, MAX_CONTENT_LENGTH);

            sources.push({
                name: outlet.name,
                url: outlet.url,
                content: truncated,
            });
        } catch (err: any) {
            sources.push({
                name: outlet.name,
                url: outlet.url,
                content: `[FETCH ERROR: ${err.message || String(err)}]`,
            });
        }
    }

    return {
        fetchedAt: new Date().toISOString(),
        sources,
    };
}

function fetchDynamicNewsContext(
    runtime: Runtime<unknown>,
    sendRequester: HTTPSendRequester,
    event: PolymarketEvent
): NewsContext {
    const query = `${event.question} ${event.description}`.slice(0, 200);
    const sources: NewsSource[] = [];

    try {
        const confClient = new ConfidentialHTTPClient();
        const searchResp = confClient.sendRequest(runtime, {
            request: {
                url: `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=4`,
                method: "GET" as const,
                multiHeaders: {
                    "Accept": { values: ["application/json"] },
                    "X-Subscription-Token": { values: ["{{.braveSearchApiKey}}"] },
                }
            },
            vaultDonSecrets: [{ key: "braveSearchApiKey" }]
        }).result();

        if (!ok(searchResp)) {
            sources.push({
                name: "Search API Error",
                url: "N/A",
                content: `[ERROR: Search API returned HTTP ${searchResp?.statusCode || "Unknown"}]`
            });
            return { fetchedAt: new Date().toISOString(), sources };
        }

        const parsed = json(searchResp) as any;

        const results = parsed.results || [];
        const topUrls = results.slice(0, 4).map((r: any) => ({
            url: r.url,
            name: r.meta_url?.hostname || "News Source"
        }));

        for (const outlet of topUrls) {
            try {
                const resp = sendRequester.sendRequest({
                    url: outlet.url,
                    method: "GET" as const,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (compatible; ChainlinkCRE/1.0)",
                        "Accept": "text/html,application/xhtml+xml,*/*",
                    },
                }).result();

                if (resp.statusCode !== 200) {
                    sources.push({
                        name: outlet.name,
                        url: outlet.url,
                        content: `[ERROR: HTTP ${resp.statusCode}]`,
                    });
                    continue;
                }

                const bodyText = new TextDecoder().decode(resp.body);
                const cleanText = stripHtmlTags(bodyText);
                const truncated = cleanText.slice(0, MAX_CONTENT_LENGTH);

                sources.push({
                    name: outlet.name,
                    url: outlet.url,
                    content: truncated,
                });
            } catch (err: any) {
                sources.push({
                    name: outlet.name,
                    url: outlet.url,
                    content: `[FETCH ERROR: ${err.message || String(err)}]`,
                });
            }
        }
    } catch (err: any) {
        sources.push({
            name: "Search Execution Error",
            url: "N/A",
            content: `[ERROR: ${err.message || String(err)}]`,
        });
    }

    return {
        fetchedAt: new Date().toISOString(),
        sources,
    };
}

export { NEWS_OUTLETS, MAX_CONTENT_LENGTH, stripHtmlTags };
