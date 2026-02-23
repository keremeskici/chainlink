import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { type NewsContext } from "./news_fetcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = {
    openaiModel: process.env.OPENAI_MODEL,
    anthropicModel: process.env.ANTHROPIC_MODEL,
    googleModel: process.env.GOOGLE_MODEL,
    deepseekModel: process.env.DEEPSEEK_MODEL,
};

const POLYMARKET_API_KEY = process.env.POLYMARKET_API_KEY_ALL;

// Re-creations of prompts to test end to end logic
function buildSystemPrompt(event: any): string {
    const optionsList = event.options
        .map((o: string, i: number) => `  ${i + 1}. "${o}"`)
        .join("\n");

    return `You are an AI consensus agent. Research the historical outcome of the following event.\n\nEVENT QUESTION: ${event.question}\n\nYou must select the single factual winner from this exact list of options:\n${optionsList}\n\nRULES:\n1. Carefully read the event question, the description/rules, and the list of options above.\n2. Recall or reason about the historical facts surrounding this event.\n3. Apply the resolution rules to the known facts step-by-step.\n4. You MUST select exactly ONE option from the list above. Do NOT invent new options.\n5. Output a STRICT JSON object with exactly two keys:\n   - "reasoning": A detailed string explaining your step-by-step logical deduction.\n   - "selected_option": A string that is EXACTLY one of the options listed above (case-sensitive, character-for-character match).\n\nDo not output any other format or wrapping text.`;
}

function buildUserPrompt(event: any, newsContext?: NewsContext): string {
    let newsSection = "";
    if (newsContext && newsContext.sources.length > 0) {
        const sourceSections = newsContext.sources
            .filter(s => !s.content.startsWith("[ERROR") && !s.content.startsWith("[FETCH"))
            .map(s => `=== ${s.name} (${s.url}) ===\n${s.content}`)
            .join("\n\n");
        if (sourceSections) {
            newsSection = `\n\nNEWS CONTEXT (from verified sources, fetched ${newsContext.fetchedAt}):\n\n${sourceSections}\n\nUse the above news articles as additional factual evidence when determining the outcome.`;
        }
    }

    return `HISTORICALLY RESOLVED PREDICTION MARKET ANALYSIS\n\nEvent Question: ${event.question}\n\nEvent Description & Resolution Rules:\n${event.description}\n\nAvailable Options:\n${event.options.map((o: string, i: number) => `  ${i + 1}. ${o}`).join("\n")}\n\nEvent Status: CLOSED (This event has already occurred and resolved.)\nHistorical Volume: $${Number(event.volume).toLocaleString()}\n\nINSTRUCTIONS:\n- This event has already been resolved. You are verifying the historical outcome.\n- Analyze the event question, resolution rules, and the list of options carefully.\n- Reason step-by-step about the known historical facts surrounding this event.\n- Select the single winning option from the list provided.\n- Provide your detailed reasoning and selected_option as JSON.${newsSection}`;
}

async function fetchTopMarket() {
    console.log("Fetching top market from Polymarket...");
    const pmUrl = "https://gamma-api.polymarket.com/events?closed=true&limit=10&order=volume&ascending=false";
    const res = await fetch(pmUrl, {
        headers: { Authorization: `Bearer ${POLYMARKET_API_KEY}` }
    });
    const data = await res.json();
    const event = data[0];

    // map
    return {
        id: event.id || "",
        question: event.title || event.question || "",
        description: event.description || "",
        options: event.markets ? event.markets.map((m: any) => m.groupItemTitle || m.title || m.question || "Unknown") : ["Yes", "No"],
        closed: event.closed ?? true,
        volume: event.volume || "0",
    }
}

async function invokeGoogle(model: string, sys: string, user: string) {
    const key = process.env.GOOGLE_API_KEY_ALL;
    const body = JSON.stringify({
        system_instruction: { parts: [{ text: sys }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
        },
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const json = await res.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(json);
}

async function invokeAnthropic(model: string, sys: string, user: string) {
    const key = process.env.ANTHROPIC_API_KEY_ALL;
    const body = JSON.stringify({
        model,
        max_tokens: 2000,
        system: sys,
        messages: [{ role: "user", content: user }],
        thinking: { type: "enabled", budget_tokens: 1024 },
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": key as string,
            "anthropic-version": "2023-06-01"
        },
        body
    });
    const json = await res.json();
    return json?.content?.[0]?.text || JSON.stringify(json);
}

async function invokeOpenAIMini(model: string, sys: string, user: string) {
    const key = process.env.OPENAI_API_KEY_ALL;
    const body = JSON.stringify({
        model,
        messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        reasoning_effort: "low",
    });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`
        },
        body
    });
    const json = await res.json();
    return json?.choices?.[0]?.message?.content || JSON.stringify(json);
}

async function invokeDeepSeek(model: string, sys: string, user: string) {
    const key = process.env.DEEPSEEK_API_KEY_ALL;
    const body = JSON.stringify({
        model,
        messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
        ],
    });

    const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`
        },
        body
    });
    const json = await res.json();
    const reasoning = json?.choices?.[0]?.message?.reasoning_content || "";
    const content = json?.choices?.[0]?.message?.content || "";
    if (!reasoning && !content) return JSON.stringify(json);
    return `[DeepSeek Reasoning]\n${reasoning}\n[Final Output]\n${content}`;
}

function loadNewsContext(): NewsContext | undefined {
    const jsonPath = resolve(__dirname, "../scripts/news_context.json");
    if (!existsSync(jsonPath)) {
        console.log("⚠ No news_context.json found. Run: npx tsx scripts/fetch_news.ts");
        console.log("  Proceeding without news context...\n");
        return undefined;
    }
    const raw = readFileSync(jsonPath, "utf-8");
    const ctx: NewsContext = JSON.parse(raw);
    console.log(`✓ Loaded news context (fetched ${ctx.fetchedAt})`);
    for (const s of ctx.sources) {
        const status = s.content.startsWith("[ERROR") || s.content.startsWith("[FETCH")
            ? "❌ FAILED"
            : `✓ ${s.content.length} chars`;
        console.log(`  - ${s.name}: ${status}`);
    }
    console.log();
    return ctx;
}

async function run() {
    try {
        // Load cached news context
        const newsContext = loadNewsContext();

        const topEvent = await fetchTopMarket();
        console.log(`\n==============================================`);
        console.log(`TARGET MARKET: ${topEvent.question}`);
        console.log(`OPTIONS: ${topEvent.options.join(", ")}`);
        console.log(`==============================================\n`);

        const sys = buildSystemPrompt(topEvent);
        const usr = buildUserPrompt(topEvent, newsContext);

        const promises = [
            async () => {
                console.log(`Starting OpenAI (${config.openaiModel})...`);
                const out = await invokeOpenAIMini(config.openaiModel as string, sys, usr);
                console.log(`\n--- OPENAI o3-mini ---\n${out}\n`);
            },
            async () => {
                console.log(`Starting Anthropic (${config.anthropicModel})...`);
                const out = await invokeAnthropic(config.anthropicModel as string, sys, usr);
                console.log(`\n--- ANTHROPIC claude-3-7-sonnet ---\n${out}\n`);
            },
            async () => {
                console.log(`Starting Google (${config.googleModel})...`);
                const out = await invokeGoogle(config.googleModel as string, sys, usr);
                console.log(`\n--- GOOGLE gemini-2.5-flash ---\n${out}\n`);
            },
            async () => {
                console.log(`Starting DeepSeek (${config.deepseekModel})...`);
                const out = await invokeDeepSeek(config.deepseekModel as string, sys, usr);
                console.log(`\n--- DEEPSEEK deepseek-reasoner ---\n${out}\n`);
            }
        ];

        await Promise.allSettled(promises.map(p => p()));

        console.log(`\n=== CONSENSUS LOGIC TEST ===`);
        console.log(`In cre-workflow/src/consensus.ts, the payload determines the top 'selected_option' integer across all passing nodes. If 1/0 or an option id breaches >75%, it signs the transaction.`);

    } catch (err) {
        console.error(err);
    }
}

run();
