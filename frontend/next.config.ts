import type { NextConfig } from "next";
import { readFileSync, existsSync } from "fs";
import path from "path";

// Manually parse .env.local since Turbopack's env loading has issues
// with monorepo-style project structures.
function loadEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const envLocal = loadEnvFile(path.resolve(__dirname, ".env.local"));

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SOP_VAULT: envLocal.NEXT_PUBLIC_SOP_VAULT || "",
    NEXT_PUBLIC_ORACLE_REGISTRY: envLocal.NEXT_PUBLIC_ORACLE_REGISTRY || "",
    NEXT_PUBLIC_RPC_URL: envLocal.NEXT_PUBLIC_RPC_URL || "",
    NEXT_PUBLIC_CHAIN_ID: envLocal.NEXT_PUBLIC_CHAIN_ID || "",
    OPENAI_MODEL: envLocal.OPENAI_MODEL || "",
    ANTHROPIC_MODEL: envLocal.ANTHROPIC_MODEL || "",
    GOOGLE_MODEL: envLocal.GOOGLE_MODEL || "",
    DEEPSEEK_MODEL: envLocal.DEEPSEEK_MODEL || "",
    ALIBABA_MODEL: envLocal.ALIBABA_MODEL || "",
    XAI_MODEL: envLocal.XAI_MODEL || "",
  },
};

export default nextConfig;
