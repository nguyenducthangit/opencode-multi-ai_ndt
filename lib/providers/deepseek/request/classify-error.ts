import type { Classification } from "../../../core/adapter.js";

/** Error patterns for DeepSeek API responses. */
export const INSUFFICIENT_BALANCE_RE =
  /insufficient balance|balance not enough|insufficient_quota|out of credit/i;
export const INVALID_KEY_RE =
  /authentication fails|invalid api key|invalid_api_key|unauthorized|bearer token/i;
export const RATE_LIMIT_RE =
  /rate limit|too many requests|rate_limit_exceeded/i;

function parseRetryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 300_000);
  }
  const dateParsed = Date.parse(header);
  if (!Number.isNaN(dateParsed)) {
    const diff = dateParsed - Date.now();
    return diff > 0 ? Math.min(diff, 300_000) : undefined;
  }
  return undefined;
}

export function classifyResponse(
  res: Response,
  bodyText: string,
): Classification {
  const status = res.status;

  if (status >= 200 && status < 300) {
    return { kind: "ok" };
  }

  const retryAfterMs = parseRetryAfterMs(res);

  // 401 Unauthorized: Invalid API Key -> auth-dead (triggers candidate dead / rotation)
  if (status === 401 || INVALID_KEY_RE.test(bodyText)) {
    return { kind: "auth-dead" };
  }

  // 402 Payment Required or Insufficient Balance -> quota-exhausted
  if (status === 402 || INSUFFICIENT_BALANCE_RE.test(bodyText)) {
    return { kind: "quota-exhausted" };
  }

  // 429 Too Many Requests -> transient rate limit
  if (status === 429 || RATE_LIMIT_RE.test(bodyText)) {
    return { kind: "transient", retryAfterMs: retryAfterMs ?? 5_000 };
  }

  // 5xx Server Errors -> retryable server error
  if (status >= 500 && status <= 599) {
    return { kind: "server", retryAfterMs: retryAfterMs ?? 2_000 };
  }

  // Other 4xx errors (e.g. 400 Bad Request, 404) -> unknown-client-error (do NOT rotate pool)
  if (status >= 400 && status < 500) {
    return { kind: "unknown-client-error", status };
  }

  return { kind: "server" };
}

export function classifyThrownError(err: unknown): Classification {
  if (typeof err === "object" && err !== null) {
    const name = "name" in err && typeof err.name === "string" ? err.name : "";
    const msg = "message" in err && typeof err.message === "string" ? err.message : "";

    if (name === "AbortError" || msg.includes("aborted")) {
      return { kind: "transient", retryAfterMs: 1_000 };
    }

    if (
      msg.includes("fetch failed") ||
      msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("network")
    ) {
      return { kind: "network" };
    }
  }

  return { kind: "network" };
}

export function classifyDeepSeekError(status: number, bodyText: string): Classification["kind"] {
  return classifyResponse(new Response(bodyText, { status }), bodyText).kind;
}
