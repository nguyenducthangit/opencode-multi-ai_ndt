import type {
  BuildHeadersContext,
  Classification,
  ProbeQuotaAccount,
  ProbeQuotaResult,
  RecordSuccessContext,
  ResolveModelsOptions,
  TransformBodyContext,
  TransportProviderAdapter,
} from "../../core/adapter.js";
import { formatUntil } from "../../core/format-time.js";
import {
  DEEPSEEK_API_BASE,
  DEEPSEEK_API_HOST,
  DUMMY_API_KEY,
  PROVIDER_ID,
  PROVIDER_KIND,
} from "./constants.js";
import { resolveDeepSeekMultiModels } from "./models-sync.js";
import { probeDeepSeekBalance } from "./request/balance.js";
import {
  classifyResponse as classifyDeepSeekResponse,
  classifyThrownError as classifyDeepSeekThrownError,
} from "./request/classify-error.js";

function toUrl(input: string | URL): URL {
  return typeof input === "string" ? new URL(input) : new URL(input.href);
}

function resolveDeepSeekUrl(input: string | URL): string {
  const url = toUrl(input);
  if (url.host !== DEEPSEEK_API_HOST) {
    url.host = DEEPSEEK_API_HOST;
    url.protocol = "https:";
  }
  return url.toString();
}

function buildDeepSeekHeaders(ctx: BuildHeadersContext): Headers {
  const headers = new Headers(ctx.initHeaders);
  headers.set("Authorization", `Bearer ${ctx.accessToken}`);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  return headers;
}

const MODEL_ALIASES: Readonly<Record<string, string>> = {
  "deepseek-v3": "deepseek-chat",
  "deepseek-v3-chat": "deepseek-chat",
  "deepseek-r1": "deepseek-reasoner",
  "deepseek-coder": "deepseek-chat",
};

function transformDeepSeekBody(
  init: RequestInit | undefined,
  _ctx: TransformBodyContext,
): RequestInit | undefined {
  if (!init || !init.body || typeof init.body !== "string") {
    return init;
  }

  try {
    const parsed = JSON.parse(init.body) as Record<string, unknown>;
    let modified = false;

    if (typeof parsed.model === "string" && MODEL_ALIASES[parsed.model]) {
      parsed.model = MODEL_ALIASES[parsed.model];
      modified = true;
    }

    if (modified) {
      return {
        ...init,
        body: JSON.stringify(parsed),
      };
    }
  } catch {
    // If not JSON, return as-is
  }

  return init;
}

function listSubtitle(account: Record<string, unknown>, now: number): string {
  if (typeof account.quotaResetAt === "number" && account.quotaResetAt > now) {
    const minsLeft = Math.ceil((account.quotaResetAt - now) / 60_000);
    return `recovering · ${minsLeft}m left`;
  }

  const parts: string[] = [];

  const balance =
    typeof account.balance === "number" ? account.balance : undefined;
  const currency =
    typeof account.currency === "string" ? account.currency : "CNY";

  if (balance !== undefined) {
    const symbol = currency === "CNY" ? "¥" : "$";
    parts.push(`balance: ${symbol}${balance.toFixed(2)} ${currency}`);
  }

  if (account.isAvailable === false) {
    parts.push("unavailable");
  }

  if (parts.length === 0) {
    return "deepseek-api";
  }

  return parts.join(" · ");
}

function detailLines(account: Record<string, unknown>, _now: number): string[] {
  const lines: string[] = [];
  const id = String(account.accountId ?? "");
  lines.push(`id: ${id}`);

  if (typeof account.label === "string" && account.label) {
    lines.push(`label: ${account.label}`);
  }

  if (typeof account.balance === "number") {
    const currency = typeof account.currency === "string" ? account.currency : "CNY";
    const symbol = currency === "CNY" ? "¥" : "$";
    lines.push(`balance: ${symbol}${account.balance.toFixed(2)} ${currency}`);
  }

  if (typeof account.grantedBalance === "number") {
    lines.push(`granted balance: ${account.grantedBalance.toFixed(2)}`);
  }

  if (typeof account.toppedUpBalance === "number") {
    lines.push(`topped-up balance: ${account.toppedUpBalance.toFixed(2)}`);
  }

  if (typeof account.isAvailable === "boolean") {
    lines.push(`available: ${account.isAvailable ? "yes" : "no"}`);
  }

  if (typeof account.usageObservedAt === "number") {
    lines.push(
      `last probed: ${new Date(account.usageObservedAt).toLocaleTimeString()}`,
    );
  }

  return lines;
}

export function createDeepSeekAdapter(): TransportProviderAdapter {
  return {
    id: PROVIDER_ID,
    provider: PROVIDER_KIND,
    displayName: "DeepSeek Multi-Account",
    npmPackage: "@ai-sdk/openai-compatible",
    baseURL: `${DEEPSEEK_API_BASE}/v1`,
    dummyApiKey: DUMMY_API_KEY,

    resolveModels: (opts: ResolveModelsOptions) =>
      resolveDeepSeekMultiModels({
        userModels: opts.userModels,
        allowNetwork: opts.allowNetwork,
        cachePath: opts.cachePath,
      }),

    providerDefaultOptions: () => ({}),

    listSubtitle,
    detailLines,

    probeQuota: async (
      accessToken: string,
      _account: ProbeQuotaAccount,
    ): Promise<ProbeQuotaResult> => {
      return probeDeepSeekBalance(accessToken);
    },

    transport: {
      kind: "http",
      resolveUrl: resolveDeepSeekUrl,
      buildHeaders: buildDeepSeekHeaders,
      transformBody: transformDeepSeekBody,
      classifyResponse: (res: Response, bodyText: string): Classification =>
        classifyDeepSeekResponse(res, bodyText),
      classifyThrownError: (err: unknown): Classification =>
        classifyDeepSeekThrownError(err),
      recordSuccess: async (_ctx: RecordSuccessContext): Promise<void> => {
        // Success hook
      },
      probeQuota: async (
        accessToken: string,
        _account: ProbeQuotaAccount,
      ): Promise<ProbeQuotaResult> => {
        return probeDeepSeekBalance(accessToken);
      },
    },
  };
}

export const deepseekAdapter = createDeepSeekAdapter();
