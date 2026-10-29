import { describe, expect, it } from "vitest";
import { deepseekAdapter } from "../lib/providers/deepseek/adapter.js";
import { resolveDeepSeekMultiModels } from "../lib/providers/deepseek/models-sync.js";
import { classifyDeepSeekError } from "../lib/providers/deepseek/request/classify-error.js";
import { addDeepSeekKey } from "../lib/providers/deepseek/auth/add-key.js";
import { AccountManager } from "../lib/core/accounts.js";
import type { DeepSeekAccountMetadata } from "../lib/core/schemas.js";

describe("DeepSeek Adapter", () => {
  it("has correct provider descriptor fields", () => {
    expect(deepseekAdapter.id).toBe("deepseek-multi");
    expect(deepseekAdapter.provider).toBe("deepseek");
    expect(deepseekAdapter.displayName).toContain("DeepSeek");
    expect(deepseekAdapter.npmPackage).toBe("@ai-sdk/openai-compatible");
    expect(deepseekAdapter.baseURL).toBe("https://api.deepseek.com/v1");
  });

  it("resolves default models correctly", async () => {
    const models = (await resolveDeepSeekMultiModels({})) as Record<
      string,
      { name: string; limit?: { context: number; output: number } }
    >;

    expect(models["deepseek-chat"]).toBeDefined();
    expect(models["deepseek-reasoner"]).toBeDefined();
    expect(models["deepseek-chat"].limit?.context).toBe(128_000);
    expect(models["deepseek-reasoner"].limit?.output).toBe(8_192);
  });

  it("formats listSubtitle and detailLines correctly", () => {
    const account: Partial<DeepSeekAccountMetadata> = {
      accountId: "ds-test-1",
      label: "My DeepSeek",
      balance: 50.5,
      currency: "CNY",
      isAvailable: true,
    };

    const subtitle = deepseekAdapter.listSubtitle(account as DeepSeekAccountMetadata, Date.now());
    expect(subtitle).toBe("balance: ¥50.50 CNY");

    const details = deepseekAdapter.detailLines(account as DeepSeekAccountMetadata, Date.now());
    expect(details).toContain("balance: ¥50.50 CNY");
  });

  it("classifies HTTP status codes accurately", () => {
    expect(classifyDeepSeekError(401, "invalid_api_key")).toBe("auth-dead");
    expect(classifyDeepSeekError(402, "insufficient balance")).toBe("quota-exhausted");
    expect(classifyDeepSeekError(429, "rate limit")).toBe("transient");
    expect(classifyDeepSeekError(500, "internal server error")).toBe("server");
  });

  it("adds a static API key to manager without errors", async () => {
    const memStorage = "/tmp/test-multi-ai-" + Math.random().toString(36).slice(2) + ".json";
    const manager = new AccountManager(memStorage);
    await manager.load();

    const acc = await addDeepSeekKey({
      apiKey: "sk-test-key-12345678",
      label: "TestKey",
      manager,
      skipProbe: true,
    });

    expect(acc.provider).toBe("deepseek");
    expect(acc.label).toBe("TestKey");
    expect(acc.accessToken).toBe("sk-test-key-12345678");

    const retrieved = manager.get("deepseek", acc.accountId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.label).toBe("TestKey");
  });
});
