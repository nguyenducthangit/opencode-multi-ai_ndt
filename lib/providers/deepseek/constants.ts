import os from "node:os";
import path from "node:path";
import type { ProviderId } from "../../core/adapter.js";

export const PROVIDER_ID: ProviderId = "deepseek-multi";
export const PROVIDER_KIND = "deepseek" as const;

export const DEEPSEEK_API_BASE = "https://api.deepseek.com";
export const DEEPSEEK_API_HOST = "api.deepseek.com";
export const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

export const DUMMY_API_KEY = "deepseek-multi-dummy";
export const MAX_ACCOUNTS = 20;

export function defaultModelsCachePath(): string {
  return path.join(
    os.homedir(),
    ".config",
    "opencode",
    "multi-ai-models-deepseek.json",
  );
}

export type DeepSeekModelEntry = {
  name: string;
  limit?: { context: number; output: number };
  modalities?: { input: string[]; output: string[] };
  description?: string;
};

export const DEEPSEEK_DEFAULT_MODELS: Record<string, DeepSeekModelEntry> = {
  "deepseek-chat": {
    name: "DeepSeek Chat (V3)",
    limit: { context: 128_000, output: 8_192 },
    modalities: { input: ["text"], output: ["text"] },
    description: "DeepSeek-V3 general-purpose model with 128K context window",
  },
  "deepseek-reasoner": {
    name: "DeepSeek Reasoner (R1)",
    limit: { context: 128_000, output: 8_192 },
    modalities: { input: ["text"], output: ["text"] },
    description: "DeepSeek-R1 reasoning model with chain-of-thought support",
  },
};

export const SUPPORTED_MODELS = Object.keys(DEEPSEEK_DEFAULT_MODELS);
