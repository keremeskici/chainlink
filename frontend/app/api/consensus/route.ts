/**
 * SSE Consensus API Route
 *
 * Orchestrates the full consensus pipeline and streams events
 * to the frontend via Server-Sent Events (SSE):
 *
 *   1. Fetch news context (Chainlink HTTP simulation)
 *   2. Prompt each AI model with event + news context
 *   3. Calculate consensus from all verdicts
 *   4. Mock on-chain write animation
 */

// Edge runtime enables true real-time SSE streaming.
// Node.js runtime in Next.js dev server buffers the entire response.
export const runtime = 'edge';

import { NextRequest } from "next/server";

// ─── Types ──────────────────────────────────────────────────────────
interface NewsSource {
    name: string;
    url: string;
    content: string;
}

interface LLMResult {
    model: string;
    reasoning: string;
    selected_option: string;
    success: boolean;
    error?: string;
}

interface MarketData {
    id: string;
    question: string;
    description: string;
    options: string[];
    volume: string;
}

// ─── News outlet configuration ──────────────────────────────────────
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

const MAX_CONTENT_LENGTH = 8000;

// ─── Helpers ────────────────────────────────────────────────────────
function stripHtmlTags(html: string): string {
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    text = text.replace(/<[^>]+>/g, " ");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/\s+/g, " ").trim();
    return text;
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Model configuration from env ──────────────────────────────────
interface ModelConfig {
    name: string;
    envModel: string;
    envKey: string;
    provider: string;
}

function getActiveModels(): ModelConfig[] {
    const potentialModels: ModelConfig[] = [
        {
            name: process.env.OPENAI_MODEL || "",
            envModel: "OPENAI_MODEL",
            envKey: "OPENAI_API_KEY",
            provider: "openai",
        },
        {
            name: process.env.ANTHROPIC_MODEL || "",
            envModel: "ANTHROPIC_MODEL",
            envKey: "ANTHROPIC_API_KEY",
            provider: "anthropic",
        },
        {
            name: process.env.GOOGLE_MODEL || "",
            envModel: "GOOGLE_MODEL",
            envKey: "GOOGLE_API_KEY",
            provider: "google",
        },
        {
            name: process.env.DEEPSEEK_MODEL || "",
            envModel: "DEEPSEEK_MODEL",
            envKey: "DEEPSEEK_API_KEY",
            provider: "deepseek",
        },
    ];

    return potentialModels
        .filter((m) => m.name.trim() !== "")
        .slice(0, 4);
}

// ─── Prompt builders ────────────────────────────────────────────────
function buildSystemPrompt(event: MarketData): string {
    const optionsList = event.options
        .map((o, i) => `  ${i + 1}. "${o}"`)
        .join("\n");

    return `You are an AI consensus agent. Research the historical outcome of the following event.

EVENT QUESTION: ${event.question}

You must select the single factual winner from this exact list of options:
${optionsList}

RULES:
1. Carefully read the event question, the description/rules, and the list of options above.
2. Recall or reason about the historical facts surrounding this event.
3. Apply the resolution rules to the known facts step-by-step.
4. You MUST select exactly ONE option from the list above. Do NOT invent new options.
5. Output a STRICT JSON object with exactly two keys:
   - "reasoning": A detailed string explaining your step-by-step logical deduction.
   - "selected_option": A string that is EXACTLY one of the options listed above (case-sensitive, character-for-character match).

Do not output any other format or wrapping text.`;
}

function buildUserPrompt(
    event: MarketData,
    newsSources: NewsSource[]
): string {
    let newsSection = "";
    const validSources = newsSources.filter(
        (s) =>
            !s.content.startsWith("[ERROR") &&
            !s.content.startsWith("[FETCH")
    );

    if (validSources.length > 0) {
        const sourceSections = validSources
            .map((s) => `=== ${s.name} (${s.url}) ===\n${s.content}`)
            .join("\n\n");
        newsSection = `\n\nNEWS CONTEXT (from verified sources):\n\n${sourceSections}\n\nUse the above news articles as additional factual evidence when determining the outcome.`;
    }

    return `HISTORICALLY RESOLVED PREDICTION MARKET ANALYSIS

Event Question: ${event.question}

Event Description & Resolution Rules:
${event.description}

Available Options:
${event.options.map((o, i) => `  ${i + 1}. ${o}`).join("\n")}

Event Status: CLOSED (This event has already occurred and resolved.)
Historical Volume: $${Number(event.volume).toLocaleString()}

INSTRUCTIONS:
- This event has already been resolved. You are verifying the historical outcome.
- Analyze the event question, resolution rules, and the list of options carefully.
- Reason step-by-step about the known historical facts surrounding this event.
- Select the single winning option from the list provided.
- Provide your detailed reasoning and selected_option as JSON.${newsSection}`;
}

// ─── LLM invocations ────────────────────────────────────────────────
async function invokeOpenAI(
    model: string,
    sys: string,
    user: string
): Promise<{ reasoning: string; selected_option: string }> {
    const key = process.env.OPENAI_API_KEY;
    const isReasoning = model.startsWith("o");
    const body: Record<string, unknown> = {
        model,
        messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
    };
    if (isReasoning) {
        body.reasoning_effort = "low";
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
    });
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || "";
    return parseJSON(content);
}

async function invokeAnthropic(
    model: string,
    sys: string,
    user: string
): Promise<{ reasoning: string; selected_option: string }> {
    const key = process.env.ANTHROPIC_API_KEY;
    const body = JSON.stringify({
        model,
        max_tokens: 2000,
        system: sys,
        messages: [{ role: "user", content: user }],
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": key as string,
            "anthropic-version": "2023-06-01",
        },
        body,
    });
    const json = await res.json();
    const content = json?.content?.[0]?.text || "";
    return parseJSON(content);
}

async function invokeGoogle(
    model: string,
    sys: string,
    user: string
): Promise<{ reasoning: string; selected_option: string }> {
    const key = process.env.GOOGLE_API_KEY;
    const body = JSON.stringify({
        system_instruction: { parts: [{ text: sys }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
        },
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    });
    const json = await res.json();
    const content =
        json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return parseJSON(content);
}

async function invokeDeepSeek(
    model: string,
    sys: string,
    user: string
): Promise<{ reasoning: string; selected_option: string }> {
    const key = process.env.DEEPSEEK_API_KEY;
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
            Authorization: `Bearer ${key}`,
        },
        body,
    });
    const data = await res.json();
    const reasoning =
        data?.choices?.[0]?.message?.reasoning_content || "";
    const content = data?.choices?.[0]?.message?.content || "";

    // Aggressively clean content by stripping markdown backticks
    const cleanedContent = content.replace(/```(?:json)?/gi, "").trim();

    let parsed;
    try {
        parsed = parseJSON(cleanedContent);
    } catch (err: any) {
        // Fallback for deeply mangled DeepSeek outputs
        parsed = {
            reasoning: "Failed to parse JSON",
            selected_option: "",
        };
    }

    if (reasoning) {
        parsed.reasoning = reasoning + "\n\n" + parsed.reasoning;
    }
    return parsed;
}

function parseJSON(raw: string): {
    reasoning: string;
    selected_option: string;
} {
    // 1. Try to extract strictly inside markdown ```json ... ```
    const markdownMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    let extractedStr = raw;
    if (markdownMatch) {
        extractedStr = markdownMatch[1];
    }

    // 2. Scan backwards from the last '}' to find a matching '{'
    let parsed: any = null;
    let foundParse = false;

    // First try a standard extraction
    const match = extractedStr.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            parsed = JSON.parse(match[0]);
            foundParse = true;
        } catch { }
    }

    // If that fails, try inner ranges backwards
    if (!foundParse) {
        const lastBraceIndex = extractedStr.lastIndexOf("}");
        if (lastBraceIndex !== -1) {
            for (let i = lastBraceIndex - 1; i >= 0; i--) {
                if (extractedStr[i] === "{") {
                    const substring = extractedStr.substring(i, lastBraceIndex + 1);
                    try {
                        parsed = JSON.parse(substring);
                        foundParse = true;
                        break;
                    } catch { }
                }
            }
        }
    }

    if (!foundParse || !parsed) {
        throw new Error("Could not parse JSON from LLM response");
    }

    return {
        reasoning: parsed.reasoning || "",
        selected_option: parsed.selected_option || "",
    };
}

async function invokeModel(
    config: ModelConfig,
    sys: string,
    user: string
): Promise<{ reasoning: string; selected_option: string }> {
    const key = process.env[config.envKey];
    if (!key) throw new Error(`Missing API key: ${config.envKey}`);

    switch (config.provider) {
        case "openai":
            return invokeOpenAI(config.name, sys, user);
        case "anthropic":
            return invokeAnthropic(config.name, sys, user);
        case "google":
            return invokeGoogle(config.name, sys, user);
        case "deepseek":
            return invokeDeepSeek(config.name, sys, user);
        default:
            throw new Error(`Unknown provider: ${config.provider}`);
    }
}

// ─── Consensus logic ────────────────────────────────────────────────
function calculateConsensus(results: LLMResult[]) {
    const successful = results.filter((r) => r.success);
    if (successful.length === 0) {
        return { resolved: false, winner: null, voteCounts: {}, totalVotes: 0 };
    }

    const voteCounts: Record<string, number> = {};
    successful.forEach((r) => {
        voteCounts[r.selected_option] =
            (voteCounts[r.selected_option] || 0) + 1;
    });

    const totalVotes = successful.length;
    let maxVotes = 0;
    let winner: string | null = null;
    let isTied = false;

    for (const [option, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) {
            maxVotes = count;
            winner = option;
            isTied = false;
        } else if (count === maxVotes) {
            isTied = true;
        }
    }

    const majorityThreshold = totalVotes / 2;
    if (isTied || maxVotes <= majorityThreshold) {
        return { resolved: false, winner: null, voteCounts, totalVotes };
    }

    return { resolved: true, winner, voteCounts, totalVotes };
}

// ─── SSE Handler ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    const body = await req.json();
    const market: MarketData = body.market;

    if (!market || !market.question || !market.options) {
        return Response.json(
            { error: "Missing market data" },
            { status: 400 }
        );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const emit = (event: string, data: Record<string, unknown>) => {
                controller.enqueue(
                    encoder.encode(
                        `data: ${JSON.stringify({ event, ...data })}\n\n`
                    )
                );
            };

            try {
                // ─── Phase 1: News Fetching ─────────────────────
                emit("phase", { phase: "news_fetch_start" });
                const newsSources: NewsSource[] = [];

                for (const outlet of NEWS_OUTLETS) {
                    emit("news_fetch", {
                        source: outlet.name,
                        status: "fetching",
                    });
                    await delay(300); // small delay for UI reactivity

                    try {
                        const res = await fetch(outlet.url, {
                            headers: {
                                "User-Agent":
                                    "Mozilla/5.0 (compatible; ChainlinkCRE/1.0)",
                                Accept: "text/html,application/xhtml+xml,*/*",
                            },
                            redirect: "follow",
                        });

                        if (!res.ok) {
                            newsSources.push({
                                name: outlet.name,
                                url: outlet.url,
                                content: `[ERROR: HTTP ${res.status}]`,
                            });
                            emit("news_fetch", {
                                source: outlet.name,
                                status: "error",
                                error: `HTTP ${res.status}`,
                            });
                            continue;
                        }

                        const html = await res.text();
                        const clean = stripHtmlTags(html);
                        const truncated = clean.slice(0, MAX_CONTENT_LENGTH);

                        newsSources.push({
                            name: outlet.name,
                            url: outlet.url,
                            content: truncated,
                        });

                        emit("news_fetch", {
                            source: outlet.name,
                            status: "done",
                            chars: truncated.length,
                        });
                    } catch (err: unknown) {
                        const msg =
                            err instanceof Error ? err.message : String(err);
                        newsSources.push({
                            name: outlet.name,
                            url: outlet.url,
                            content: `[FETCH ERROR: ${msg}]`,
                        });
                        emit("news_fetch", {
                            source: outlet.name,
                            status: "error",
                            error: msg,
                        });
                    }
                }

                emit("phase", { phase: "news_fetch_complete" });
                await delay(500);

                // ─── Phase 2: AI Swarm ──────────────────────────
                emit("phase", { phase: "swarm_start" });
                const activeModels = getActiveModels();
                const systemPrompt = buildSystemPrompt(market);
                const userPrompt = buildUserPrompt(market, newsSources);
                const results: LLMResult[] = [];

                for (const model of activeModels) {
                    emit("model_start", {
                        model: model.name,
                        provider: model.provider,
                    });

                    try {
                        const result = await invokeModel(
                            model,
                            systemPrompt,
                            userPrompt
                        );

                        results.push({
                            model: model.name,
                            reasoning: result.reasoning,
                            selected_option: result.selected_option,
                            success: true,
                        });

                        emit("model_done", {
                            model: model.name,
                            provider: model.provider,
                            reasoning: result.reasoning,
                            selected_option: result.selected_option,
                            success: true,
                        });
                    } catch (err: unknown) {
                        const msg =
                            err instanceof Error ? err.message : String(err);
                        results.push({
                            model: model.name,
                            reasoning: "",
                            selected_option: "",
                            success: false,
                            error: msg,
                        });

                        emit("model_done", {
                            model: model.name,
                            provider: model.provider,
                            success: false,
                            error: msg,
                        });
                    }
                }

                emit("phase", { phase: "swarm_complete" });
                await delay(500);

                // ─── Phase 3: Consensus ─────────────────────────
                emit("phase", { phase: "consensus_start" });
                await delay(800);

                const consensus = calculateConsensus(results);

                emit("consensus", {
                    resolved: consensus.resolved,
                    winner: consensus.winner,
                    voteCounts: consensus.voteCounts,
                    totalVotes: consensus.totalVotes,
                });

                await delay(1500);

                // ─── Phase 4: Mock Chain Write ──────────────────
                emit("phase", { phase: "chain_write" });
                emit("chain_status", {
                    status: "submitting",
                    message: "Broadcasting to UMA Network...",
                });
                await delay(2000);

                emit("chain_status", {
                    status: "confirming",
                    message: "Waiting for block confirmation...",
                });
                await delay(1500);

                const mockTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;

                emit("chain_status", {
                    status: "confirmed",
                    message: "Transaction confirmed",
                    txHash: mockTxHash,
                });
                await delay(1000);

                // ─── Phase 5: Complete ──────────────────────────
                emit("phase", { phase: "complete" });
                emit("complete", {
                    winner: consensus.winner,
                    resolved: consensus.resolved,
                    txHash: mockTxHash,
                });
            } catch (err: unknown) {
                const msg =
                    err instanceof Error ? err.message : String(err);
                emit("error", { message: msg });
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
