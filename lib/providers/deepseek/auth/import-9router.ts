import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { AccountOf } from "../../../core/schemas.js";
import { getAccountManager, type AccountManager } from "../../../core/accounts.js";
import { logger } from "../../../core/logger.js";
import { probeDeepSeekBalance } from "../request/balance.js";

export interface N9RouterConnection {
  id: string;
  provider: string;
  name?: string;
  email?: string;
  refreshToken?: string;
  accessToken?: string;
  apiKey?: string;
  expiresAt?: string | number;
  priority?: number;
  isActive?: boolean;
  createdAt?: string | number;
  lastUsedAt?: string | number;
}

export interface DeepSeekImportResult {
  totalIn9Router: number;
  imported: number;
  skipped: number;
  errors: string[];
  accounts: AccountOf<"deepseek">[];
}

export async function importDeepSeekFrom9Router(
  options: {
    dbPath?: string;
    manager?: AccountManager;
    skipProbe?: boolean;
  } = {},
): Promise<DeepSeekImportResult> {
  const dbPath =
    options.dbPath || path.join(os.homedir(), ".n9router", "db.json");
  const manager = options.manager || getAccountManager();
  await manager.load();

  let rawContent: string;
  try {
    rawContent = await readFile(dbPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Cannot read 9Router db at ${dbPath}: ${(err as Error).message}`,
    );
  }

  let db: { providerConnections?: N9RouterConnection[] };
  try {
    db = JSON.parse(rawContent) as { providerConnections?: N9RouterConnection[] };
  } catch (err) {
    throw new Error(
      `Invalid JSON in 9Router db at ${dbPath}: ${(err as Error).message}`,
    );
  }

  const connections = Array.isArray(db.providerConnections)
    ? db.providerConnections
    : [];

  const dsConnections = connections.filter(
    (c) =>
      c.provider === "deepseek" &&
      typeof (c.apiKey || c.accessToken || c.refreshToken) === "string" &&
      (c.apiKey || c.accessToken || c.refreshToken)!.trim().length > 0,
  );

  const result: DeepSeekImportResult = {
    totalIn9Router: dsConnections.length,
    imported: 0,
    skipped: 0,
    errors: [],
    accounts: [],
  };

  const existingAccounts = manager.list("deepseek");
  const existingByToken = new Set(
    existingAccounts.map((a) => a.accessToken ?? a.refreshToken),
  );
  const existingById = new Set(existingAccounts.map((a) => a.accountId));

  const now = Date.now();

  for (const conn of dsConnections) {
    try {
      const apiKey = (conn.apiKey || conn.accessToken || conn.refreshToken)!.trim();
      if (existingByToken.has(apiKey)) {
        result.skipped++;
        continue;
      }

      const accountId =
        conn.id && !existingById.has(conn.id)
          ? conn.id
          : `ds-${conn.name?.replace(/[^a-zA-Z0-9]/g, "_") || Math.random().toString(36).slice(2, 9)}`;

      let addedAt = now;
      if (typeof conn.createdAt === "number") {
        addedAt = conn.createdAt;
      } else if (typeof conn.createdAt === "string") {
        const parsed = new Date(conn.createdAt).getTime();
        if (!Number.isNaN(parsed)) addedAt = parsed;
      }

      let lastUsed = 0;
      if (typeof conn.lastUsedAt === "number") {
        lastUsed = conn.lastUsedAt;
      } else if (typeof conn.lastUsedAt === "string") {
        const parsed = new Date(conn.lastUsedAt).getTime();
        if (!Number.isNaN(parsed)) lastUsed = parsed;
      }

      const newAccount: AccountOf<"deepseek"> = {
        provider: "deepseek",
        accountId,
        email: conn.email,
        label: conn.name || `DeepSeek ${accountId.slice(0, 6)}`,
        tags: ["imported-9router"],
        refreshToken: apiKey,
        accessToken: apiKey,
        expiresAt: Number.MAX_SAFE_INTEGER,
        enabled: conn.isActive !== false,
        priority: typeof conn.priority === "number" ? conn.priority : 0,
        addedAt,
        lastUsed,
        lastSwitchReason: "initial",
        subscriptionStatus: "active",
        flaggedForRemoval: false,
        entitlementBlocked: false,
      };

      if (!options.skipProbe) {
        try {
          const balanceRes = await probeDeepSeekBalance(apiKey);
          if (balanceRes.ok) {
            newAccount.balance = typeof balanceRes.balance === "number" ? balanceRes.balance : undefined;
            newAccount.currency = typeof balanceRes.currency === "string" ? balanceRes.currency : undefined;
            newAccount.grantedBalance = typeof balanceRes.grantedBalance === "number" ? balanceRes.grantedBalance : undefined;
            newAccount.toppedUpBalance = typeof balanceRes.toppedUpBalance === "number" ? balanceRes.toppedUpBalance : undefined;
            newAccount.isAvailable = typeof balanceRes.isAvailable === "boolean" ? balanceRes.isAvailable : undefined;
            newAccount.usageObservedAt = Date.now();
          }
        } catch {
          // Probe failure is non-fatal on import
        }
      }

      await manager.upsertFromOAuth("deepseek", newAccount);
      existingById.add(accountId);
      existingByToken.add(apiKey);

      result.imported++;
      result.accounts.push(newAccount);
    } catch (err) {
      const msg = `Failed to import connection ${conn.id || conn.name}: ${(err as Error).message}`;
      logger.error(msg);
      result.errors.push(msg);
    }
  }

  return result;
}
