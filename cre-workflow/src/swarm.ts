/**
 * AI Swarm Executor — CRE Confidential HTTP Client
 *
 * All LLM API calls execute inside the CRE Confidential HTTP enclave.
 * API keys are injected via Vault DON secret templating ({{.secretKey}})
 * and never appear in workflow code or DON node memory.
 */
import {
  ConfidentialHTTPClient,
  ok,
  json,
  type Runtime,
} from "@chainlink/cre-sdk";
import { type Config, type ProviderSpec, getActiveProviders } from "./config";
import { type PolymarketEvent } from "./polymarket";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
export interface LLMResponse {
  reasoning: string;
  selected_option: string;
}

export interface SwarmResult {
  providerName: string;
  success: boolean;
  data?: LLMResponse;
  error?: string;
}

export interface SwarmOutput {
  results: SwarmResult[];
}

// ---------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------
function buildSystemPrompt(event: PolymarketEvent): string {
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

function buildUserPrompt(event: PolymarketEvent): string {
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
- Provide your detailed reasoning and selected_option as JSON.`;
}

// ---------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------
function validateSelectedOption(
  selectedOption: string,
  validOptions: string[]
): boolean {
  return validOptions.includes(selectedOption);
}

export function parseLLMResponse(
  content: string,
  validOptions: string[]
): LLMResponse {
  // 1. Ignore everything before [Final Output] if present
  const finalIndex = content.lastIndexOf("[Final Output]");
  if (finalIndex !== -1) {
    content = content.substring(finalIndex + "[Final Output]".length);
  }

  // 2. Try to extract strictly inside markdown ```json ... ```
  const markdownMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  let extractedStr = content;
  if (markdownMatch) {
    extractedStr = markdownMatch[1];
  }

  // Attempt JSON parse
  let parsed: any = null;
  let foundParse = false;

  // First try the raw extracted string
  try {
    parsed = JSON.parse(extractedStr);
    foundParse = true;
  } catch {
    // 3. Scan backwards from the last '}' to find a matching '{' that produces valid JSON
    const lastBraceIndex = extractedStr.lastIndexOf("}");
    if (lastBraceIndex !== -1) {
      for (let i = lastBraceIndex - 1; i >= 0; i--) {
        if (extractedStr[i] === "{") {
          const substring = extractedStr.substring(i, lastBraceIndex + 1);
          try {
            parsed = JSON.parse(substring);
            foundParse = true;
            break;
          } catch {
            // Continue trying earlier '{'
          }
        }
      }
    }
  }

  if (!foundParse) {
    throw new Error("Could not parse JSON from LLM response");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Parsed JSON is not an object");
  }

  if (!parsed.selected_option || typeof parsed.selected_option !== "string") {
    throw new Error("LLM response missing 'selected_option' field");
  }

  const matchedOption = validateSelectedOption(
    parsed.selected_option,
    validOptions
  );
  if (!matchedOption) {
    throw new Error(
      `LLM returned invalid option "${parsed.selected_option
      }". Valid: [${validOptions.join(", ")}]`
    );
  }

  // Mutate to exact valid option so downstream consensus algorithms don't break
  parsed.selected_option = matchedOption;

  return {
    reasoning: parsed.reasoning || "",
    selected_option: parsed.selected_option,
  };
}

// ---------------------------------------------------------------------
// Provider-specific request builders
// ---------------------------------------------------------------------

/**
 * Builds a Confidential HTTP request for OpenAI-compatible APIs.
 * Secret template: {{.secretKey}} resolves inside the enclave.
 */
function buildOpenAIMiniRequest(
  provider: ProviderSpec,
  model: string,
  systemPrompt: string,
  userPrompt: string
) {
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    reasoning_effort: "low",
  });

  return {
    request: {
      url: provider.endpoint,
      method: "POST" as const,
      multiHeaders: {
        Authorization: {
          values: [`Bearer {{.${provider.secretKey}}}`],
        },
        "Content-Type": { values: ["application/json"] },
      },
      body: new TextEncoder().encode(body),
    },
    vaultDonSecrets: [{ key: provider.secretKey }],
  };
}

/**
 * Builds a Confidential HTTP request for Anthropic Messages API.
 */
function buildAnthropicRequest(
  provider: ProviderSpec,
  model: string,
  systemPrompt: string,
  userPrompt: string
) {
  const body = JSON.stringify({
    model,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    thinking: { type: "enabled", budget_tokens: 1024 },
  });

  return {
    request: {
      url: provider.endpoint,
      method: "POST" as const,
      multiHeaders: {
        "x-api-key": {
          values: [`{{.${provider.secretKey}}}`],
        },
        "anthropic-version": { values: ["2023-06-01"] },
        "Content-Type": { values: ["application/json"] },
      },
      body: new TextEncoder().encode(body),
    },
    vaultDonSecrets: [{ key: provider.secretKey }],
  };
}

/**
 * Builds a Confidential HTTP request for Google Gemini API.
 * Note: Google uses query-param auth, so the secret goes into the URL template.
 */
function buildGoogleRequest(
  provider: ProviderSpec,
  model: string,
  systemPrompt: string,
  userPrompt: string
) {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  // Google Gemini uses ?key= query param for auth
  const url = `${provider.endpoint}/${model}:generateContent?key={{.${provider.secretKey}}}`;

  return {
    request: {
      url,
      method: "POST" as const,
      multiHeaders: {
        "Content-Type": { values: ["application/json"] },
      },
      body: new TextEncoder().encode(body),
    },
  };
}

/**
 * Builds a Confidential HTTP request specifically for DeepSeek APIs.
 */
function buildDeepSeekRequest(
  provider: ProviderSpec,
  model: string,
  systemPrompt: string,
  userPrompt: string
) {
  const aggressiveFormattingInstruction =
    "CRITICAL: You must output ONLY a raw JSON object. Do not include markdown formatting like ```json. Do not include conversational text before or after.";
  const enhancedUserPrompt = `${userPrompt}\n\n${aggressiveFormattingInstruction}`;

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: enhancedUserPrompt },
    ],
    // Deepseek Reasoner does not support forcing JSON objects natively
  });

  return {
    request: {
      url: provider.endpoint,
      method: "POST" as const,
      multiHeaders: {
        Authorization: {
          values: [`Bearer {{.${provider.secretKey}}}`],
        },
        "Content-Type": { values: ["application/json"] },
      },
      body: new TextEncoder().encode(body),
    },
    vaultDonSecrets: [{ key: provider.secretKey }],
  };
}

// ---------------------------------------------------------------------
// Response extractors (provider-specific JSON paths)
// ---------------------------------------------------------------------
function extractContent(providerName: string, responseBody: any): string {
  switch (providerName) {
    case "Anthropic":
      return responseBody?.content?.[0]?.text || "";
    case "Google":
      return responseBody?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    case "DeepSeek": {
      const dsReasoning =
        responseBody?.choices?.[0]?.message?.reasoning_content || "";
      let dsContent = responseBody?.choices?.[0]?.message?.content || "";

      if (dsReasoning) {
        // Preserve reasoning in logs instead of bleeding into the output string
        console.log("[DeepSeek Reasoning]\n", dsReasoning);
      }

      return dsContent.trim();
    }
    default:
      // OpenAI o3-mini (Reasoning)
      return responseBody?.choices?.[0]?.message?.content || "";
  }
}

// ---------------------------------------------------------------------
// Swarm execution — Confidential HTTP sendRequest-compatible
// ---------------------------------------------------------------------

/**
 * Executes the full AI swarm inside the CRE Confidential HTTP enclave.
 *
 * This function signature matches the CRE `sendRequest` pattern:
 *   (sendRequester: ConfidentialHTTPSendRequester, config: Config, event: PolymarketEvent) => SwarmOutput
 *
 * Each LLM call is sent via `sendRequester.sendRequest()` with
 * Vault DON secret injection. Since Confidential HTTP guarantees
 * single execution inside the enclave, each call is made exactly once.
 */
export const executeSwarm = (
  runtime: Runtime<unknown>,
  config: Config,
  event: PolymarketEvent
): SwarmOutput => {
  const activeProviders = getActiveProviders(config);

  if (activeProviders.length === 0) {
    throw new Error("No active AI models configured in config.json");
  }

  const systemPrompt = buildSystemPrompt(event);
  const userPrompt = buildUserPrompt(event);
  const results: SwarmResult[] = [];

  const confHTTPClient = new ConfidentialHTTPClient();

  for (const provider of activeProviders) {
    try {
      const model = config[provider.modelField] as string;

      // Build provider-specific confidential request
      let reqConfig;
      if (provider.name === "Anthropic") {
        reqConfig = buildAnthropicRequest(
          provider,
          model,
          systemPrompt,
          userPrompt
        );
      } else if (provider.name === "Google") {
        reqConfig = buildGoogleRequest(
          provider,
          model,
          systemPrompt,
          userPrompt
        );
      } else if (provider.name === "DeepSeek") {
        reqConfig = buildDeepSeekRequest(
          provider,
          model,
          systemPrompt,
          userPrompt
        );
      } else {
        // OpenAI (o3-mini)
        reqConfig = buildOpenAIMiniRequest(
          provider,
          model,
          systemPrompt,
          userPrompt
        );
      }

      // Execute inside the Confidential HTTP enclave
      const response = confHTTPClient
        .sendRequest(runtime, reqConfig as any)
        .result();

      if (!ok(response)) {
        throw new Error(
          `${provider.name} API returned status ${response.statusCode}`
        );
      }

      // Parse the provider's response format
      const responseBody = json(response);
      const content = extractContent(provider.name, responseBody);
      const parsed = parseLLMResponse(content, event.options);

      results.push({
        providerName: provider.name,
        success: true,
        data: parsed,
      });
    } catch (error: any) {
      results.push({
        providerName: provider.name,
        success: false,
        error: error.message || String(error),
      });
    }
  }

  return { results };
};
