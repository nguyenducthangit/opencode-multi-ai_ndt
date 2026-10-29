/**
 * Pure error classifier for Antigravity (Google Cloud Code / Gemini Code
 * Assist) responses.
 *
 * Google signals account-level problems in the response body, not only in the
 * status code. This module maps a response (or a thrown error) to a single
 * discriminated kind so the fetch pipeline can decide — once — whether to
 * rotate, quarantine, or give up. It is PURE and SYNCHRONOUS: no I/O, no
 * logging, no pool mutations. The caller owns all side effects.
 *
 * Canonical account-state transitions (see lib/core/accounts.ts):
 *
 *   kind                        → account state
 *   --------------------------- → ---------------------------------------
 *   ok                          → untouched (account stays healthy)
 *   quota-exhausted             → quotaResetAt set (RECOVERABLE, rotates)
 *   entitlement-blocked         → entitlementBlocked = true (VALID cred)
 *   provider-disabled           → subscriptionStatus = "dead" (ToS / disabled)
 *   auth-failure                → subscriptionStatus = "dead" (invalid_grant)
 *   transient                   → untouched (rotate to sibling, keep cred)
 *   unknown-client-error        → untouched (do NOT rotate the pool)
 */

/** Google disabled the account (Terms of Service / service disabled). */
export const PROVIDER_DISABLED_RE =
  /violation of terms of service|disabled in this account|Google disabled service/i;

/** The account needs a re-validation / re-consent step before it can serve. */
export const VALIDATION_REQUIRED_RE = /VALIDATION_REQUIRED/i;

/** Plan / allowlist gate — the credential is fine, the model is not granted. */
export const ENTITLEMENT_RE =
  /not\s+(?:available|allowed|supported|entitled)|does not have access|not enabled for|forbidden for this account/i;

/** Google-side quota exhaustion (recoverable — the window resets). */
export const QUOTA_EXHAUSTED_RE =
  /resource exhausted|quota exceeded|quota exhausted|RESOURCE_EXHAUSTED|rate limit exceeded/i;

/** Per-request throttling (recoverable, short backoff — account stays usable). */
export const RATE_LIMIT_RE =
  /rate limit exceeded|too many requests|RESOURCE_EXHAUSTED: rate/i;

/** Structured error status names Google returns in the error envelope. */
export type AntigravityErrorStatus =
  | "RESOURCE_EXHAUSTED"
  | "PERMISSION_DENIED"
  | "UNAUTHENTICATED"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "INTERNAL"
  | "UNAVAILABLE"
  | "DEADLINE_EXCEEDED"
  | "UNKNOWN";

export type AntigravityClassification =
  | { kind: "ok" }
  /** Quota window exhausted — recoverable, rotate to a sibling. */
  | { kind: "quota-exhausted"; resetAtMs?: number }
  /** Plan does not include the model — credential still valid. */
  | { kind: "entitlement-blocked" }
  /** Google disabled the account (ToS) — terminal for this account. */
  | { kind: "provider-disabled" }
  /** Credential rejected (invalid_grant / revoked token) — terminal. */
  | { kind: "auth-failure" }
  /** Server / network hiccup — rotate, keep the credential. */
  | { kind: "transient" }
  /** Anything else — do NOT rotate the pool on this alone. */
  | { kind: "unknown-client-error"; status: number };

function parseEnvelope(text: string): {
  status?: AntigravityErrorStatus;
  message?: string;
} {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as {
      error?: { status?: string; message?: string; code?: number };
    };
    const raw = parsed?.error?.status;
    const status =
      raw && typeof raw === "string"
        ? (raw.toUpperCase().replace(/\s+/g, "_") as AntigravityErrorStatus)
        : undefined;
    return { status, message: parsed?.error?.message };
  } catch {
    return {};
  }
}

/**
 * Classify an HTTP response from the Antigravity endpoint.
 *
 * Order matters: the Google account-level signals (ToS / VALIDATION_REQUIRED)
 * are checked BEFORE the generic 403 quota path, because a disabled account
 * answers 403 too and must not be treated as a recoverable quota event.
 */
export function classifyAntigravityResponse(
  status: number,
  bodyText: string,
  headers?: Headers,
): AntigravityClassification {
  if (status >= 200 && status < 300) return { kind: "ok" };

  const text = bodyText ?? "";
  const env = parseEnvelope(text);
  const haystack = `${env.message ?? ""} ${text}`;

  if (PROVIDER_DISABLED_RE.test(haystack)) {
    return { kind: "provider-disabled" };
  }

  if (VALIDATION_REQUIRED_RE.test(haystack)) {
    return { kind: "entitlement-blocked" };
  }

  if (status === 401 || env.status === "UNAUTHENTICATED") {
    return { kind: "auth-failure" };
  }

  if (status === 429 || env.status === "RESOURCE_EXHAUSTED") {
    if (RATE_LIMIT_RE.test(haystack) && !QUOTA_EXHAUSTED_RE.test(haystack)) {
      return { kind: "transient" };
    }
    return { kind: "quota-exhausted" };
  }

  if (status >= 500) {
    return { kind: "transient" };
  }

  if (status === 403) {
    if (ENTITLEMENT_RE.test(haystack)) return { kind: "entitlement-blocked" };
    return { kind: "quota-exhausted" };
  }

  return { kind: "unknown-client-error", status };
}

/** Classify a thrown error (network failure, timeout, aborted request). */
export function classifyAntigravityThrownError(err: unknown): AntigravityClassification {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/invalid_grant/i.test(message)) return { kind: "auth-failure" };
  if (
    err instanceof TypeError ||
    /abort|timed out|timeout|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(
      message,
    )
  ) {
    return { kind: "transient" };
  }
  return { kind: "unknown-client-error", status: 0 };
}
