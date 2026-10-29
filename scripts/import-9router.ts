#!/usr/bin/env bun
import { importAntigravityFrom9Router } from "../lib/providers/antigravity/auth/import-9router.js";
import { importDeepSeekFrom9Router } from "../lib/providers/deepseek/auth/import-9router.js";
import { getAccountManager } from "../lib/core/accounts.js";

async function main() {
  console.log("🔍 Scanning 9Router accounts from ~/.n9router/db.json...");

  const manager = getAccountManager();
  await manager.load();

  // 1. Antigravity Import
  try {
    const res = await importAntigravityFrom9Router({ manager });
    console.log(`\n✅ Antigravity Import:`);
    console.log(`   - Total in 9Router: ${res.totalIn9Router}`);
    console.log(`   - Newly imported:   ${res.imported}`);
    console.log(`   - Skipped (exist):  ${res.skipped}`);

    if (res.errors.length > 0) {
      console.log(`   - Errors encountered: ${res.errors.length}`);
      for (const err of res.errors) console.error(`     ⚠️ ${err}`);
    }

    const allAg = manager.list("antigravity");
    console.log(`🎉 Current Antigravity pool has ${allAg.length} account(s):`);
    for (const acc of allAg) {
      console.log(`   • ${acc.email || acc.accountId} (priority: ${acc.priority}, status: ${acc.subscriptionStatus})`);
    }

    const sticky = manager.sticky("antigravity");
    console.log(`📌 Active Antigravity Sticky: ${sticky || "None"}`);
  } catch (err) {
    console.error(`⚠️ Failed to import Antigravity: ${(err as Error).message}`);
  }

  // 2. DeepSeek Import
  try {
    const dsRes = await importDeepSeekFrom9Router({ manager });
    console.log(`\n✅ DeepSeek Import:`);
    console.log(`   - Total in 9Router: ${dsRes.totalIn9Router}`);
    console.log(`   - Newly imported:   ${dsRes.imported}`);
    console.log(`   - Skipped (exist):  ${dsRes.skipped}`);

    if (dsRes.errors.length > 0) {
      console.log(`   - Errors encountered: ${dsRes.errors.length}`);
      for (const err of dsRes.errors) console.error(`     ⚠️ ${err}`);
    }

    const allDs = manager
      .list("deepseek")
      .filter((a): a is import("../lib/core/schemas.js").DeepSeekAccountMetadata => a.provider === "deepseek");
    console.log(`🎉 Current DeepSeek pool has ${allDs.length} account(s):`);
    for (const acc of allDs) {
      console.log(`   • ${acc.label || acc.accountId} (priority: ${acc.priority}, status: ${acc.subscriptionStatus}, balance: ${acc.currency || "CNY"} ${acc.balance ?? "unknown"})`);
    }

    const stickyDs = manager.sticky("deepseek");
    console.log(`📌 Active DeepSeek Sticky: ${stickyDs || "None"}`);
  } catch (err) {
    console.error(`⚠️ Failed to import DeepSeek: ${(err as Error).message}`);
  }
}

main();
