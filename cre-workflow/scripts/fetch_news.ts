#!/usr/bin/env npx tsx
/**
 * Standalone News Fetcher Script
 *
 * Simulates the Chainlink CRE HTTP logic locally using native fetch().
 * Fetches news content from Reuters, CNN, and BBC, strips HTML,
 * and saves the result to scripts/news_context.json for reuse.
 *
 * Usage: npx tsx scripts/fetch_news.ts
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Re-import types and constants from the CRE module
import {
    NEWS_OUTLETS,
    MAX_CONTENT_LENGTH,
    stripHtmlTags,
    type NewsContext,
    type NewsSource,
} from "../src/news_fetcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function fetchSingleSource(outlet: {
    name: string;
    url: string;
}): Promise<NewsSource> {
    console.log(`  Fetching ${outlet.name}...`);
    console.log(`    URL: ${outlet.url}`);

    try {
        const res = await fetch(outlet.url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; ChainlinkCRE/1.0)",
                Accept: "text/html,application/xhtml+xml,*/*",
            },
            redirect: "follow",
        });

        if (!res.ok) {
            console.log(`    ❌ HTTP ${res.status} ${res.statusText}`);
            return {
                name: outlet.name,
                url: outlet.url,
                content: `[ERROR: HTTP ${res.status} ${res.statusText}]`,
            };
        }

        const html = await res.text();
        console.log(`    ✓ Received ${html.length} bytes of HTML`);

        const cleanText = stripHtmlTags(html);
        const truncated = cleanText.slice(0, MAX_CONTENT_LENGTH);
        console.log(
            `    ✓ Extracted ${cleanText.length} chars of text, truncated to ${truncated.length}`
        );

        return {
            name: outlet.name,
            url: outlet.url,
            content: truncated,
        };
    } catch (err: any) {
        console.log(`    ❌ Fetch error: ${err.message}`);
        return {
            name: outlet.name,
            url: outlet.url,
            content: `[FETCH ERROR: ${err.message || String(err)}]`,
        };
    }
}

async function main() {
    console.log("==============================================");
    console.log("  Chainlink CRE — News Context Fetcher");
    console.log("  (Simulating HTTPSendRequester locally)");
    console.log("==============================================\n");

    console.log(`Fetching ${NEWS_OUTLETS.length} news sources...\n`);

    const sources: NewsSource[] = [];
    for (const outlet of NEWS_OUTLETS) {
        const source = await fetchSingleSource(outlet);
        sources.push(source);
        console.log();
    }

    const newsContext: NewsContext = {
        fetchedAt: new Date().toISOString(),
        sources,
    };

    const outPath = resolve(__dirname, "news_context.json");
    writeFileSync(outPath, JSON.stringify(newsContext, null, 2), "utf-8");

    console.log("==============================================");
    console.log(`✓ Saved news context to: ${outPath}`);
    console.log(`  Sources: ${sources.length}`);
    for (const s of sources) {
        const status = s.content.startsWith("[ERROR") || s.content.startsWith("[FETCH")
            ? "❌ FAILED"
            : `✓ ${s.content.length} chars`;
        console.log(`    - ${s.name}: ${status}`);
    }
    console.log("==============================================");
}

main().catch(console.error);
