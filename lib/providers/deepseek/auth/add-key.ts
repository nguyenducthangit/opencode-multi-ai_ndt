import crypto from "node:crypto";
import type { AccountOf } from "../../../core/schemas.js";
import { getAccountManager, type AccountManager } from "../../../core/accounts.js";
import { probeDeepSeekBalance } from "../request/balance.js";

export interface AddDeepSeekKeyOptions {
  apiKey: string;
  label?: string;
  priority?: number;
  manager?: AccountManager;
  skipProbe?: boolean;
}

export async function addDeepSeekKey(
  options: AddDeepSeekKeyOptions,
): Promise<AccountOf<"deepseek">> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error("DeepSeek API key is required");
  }

  const manager = options.manager || getAccountManager();
  await manager.load();

  const accountId = crypto
    .createHash("sha256")
    .update(apiKey)
    .digest("hex")
    .slice(0, 16);

  const existing = manager.get("deepseek", accountId);
  const now = Date.now();

  const account: AccountOf<"deepseek"> = {
    provider: "deepseek",
    accountId,
    label: options.label || `DeepSeek-${accountId.slice(0, 6)}`,
    tags: [],
    refreshToken: apiKey,
    accessToken: apiKey,
    expiresAt: Number.MAX_SAFE_INTEGER,
    enabled: true,
    priority: typeof options.priority === "number" ? options.priority : (existing?.priority ?? 0),
    addedAt: existing?.addedAt ?? now,
    lastUsed: existing?.lastUsed ?? 0,
    lastSwitchReason: "initial",
    subscriptionStatus: "active",
    flaggedForRemoval: false,
    entitlementBlocked: false,
  };

  if (!options.skipProbe) {
    try {
      const balanceRes = await probeDeepSeekBalance(apiKey);
      if (balanceRes.ok) {
        account.balance = typeof balanceRes.balance === "number" ? balanceRes.balance : undefined;
        account.currency = typeof balanceRes.currency === "string" ? balanceRes.currency : undefined;
        account.grantedBalance = typeof balanceRes.grantedBalance === "number" ? balanceRes.grantedBalance : undefined;
        account.toppedUpBalance = typeof balanceRes.toppedUpBalance === "number" ? balanceRes.toppedUpBalance : undefined;
        account.isAvailable = typeof balanceRes.isAvailable === "boolean" ? balanceRes.isAvailable : undefined;
        account.usageObservedAt = Date.now();
      }
    } catch {
      // Ignore probe failures
    }
  }

  await manager.upsertFromOAuth("deepseek", account);
  return account;
}
