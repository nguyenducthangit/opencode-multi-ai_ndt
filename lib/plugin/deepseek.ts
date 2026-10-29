import type { Plugin } from "@opencode-ai/plugin";

import { toRotationManager } from "../core/account-rotation.js";
import { getAccountManager } from "../core/accounts.js";
import { logger } from "../core/logger.js";
import { createProviderFetch } from "../core/provider-fetch.js";
import { bootstrapHostAuthIfNeeded } from "../providers/codex/auth/host-auth.js";
import { deepseekAdapter } from "../providers/deepseek/adapter.js";
import { addDeepSeekKey } from "../providers/deepseek/auth/add-key.js";
import { importDeepSeekFrom9Router } from "../providers/deepseek/auth/import-9router.js";
import {
  DEEPSEEK_API_BASE,
  DUMMY_API_KEY,
  PROVIDER_ID,
} from "../providers/deepseek/constants.js";
import { resolveDeepSeekMultiModels } from "../providers/deepseek/models-sync.js";

const plugin: Plugin = async () => {
  logger.debug("multi-deepseek plugin loading (server entry)");
  bootstrapHostAuthIfNeeded(PROVIDER_ID, DUMMY_API_KEY);
  const manager = getAccountManager();
  await manager.load();

  const baseURL = `${DEEPSEEK_API_BASE}/v1`;
  const customFetch = createProviderFetch(
    deepseekAdapter,
    toRotationManager(manager, "deepseek"),
  );

  return {
    config: async (cfg) => {
      const c = cfg as {
        provider?: Record<string, Record<string, unknown>>;
      };
      if (!c.provider) c.provider = {};
      if (!c.provider[PROVIDER_ID]) c.provider[PROVIDER_ID] = {};
      const p = c.provider[PROVIDER_ID];

      if (p.npm === undefined) {
        p.npm = deepseekAdapter.npmPackage;
      }
      if (p.name === undefined) {
        p.name = deepseekAdapter.displayName;
      }
      if (p.options === undefined || typeof p.options !== "object") {
        p.options = { baseURL, apiKey: DUMMY_API_KEY };
      } else {
        const opts = p.options as Record<string, unknown>;
        if (opts.baseURL === undefined) opts.baseURL = baseURL;
        if (opts.apiKey === undefined) opts.apiKey = DUMMY_API_KEY;
      }

      bootstrapHostAuthIfNeeded(PROVIDER_ID, DUMMY_API_KEY);

      const existing =
        p.models && typeof p.models === "object"
          ? (p.models as Record<string, unknown>)
          : {};

      p.models = await resolveDeepSeekMultiModels({
        userModels: existing,
        allowNetwork: false,
      });

      logger.debug("multi-deepseek config hook: provider registered", {
        provider: PROVIDER_ID,
        modelCount: Object.keys(p.models as object).length,
      });
    },

    auth: {
      provider: PROVIDER_ID,
      loader: async () => ({
        apiKey: deepseekAdapter.dummyApiKey,
        baseURL,
        fetch: customFetch,
      }),
      methods: [
        {
          type: "oauth",
          label: "Import DeepSeek from 9Router (~/.n9router/db.json)",
          async authorize() {
            return {
              url: "https://platform.deepseek.com",
              instructions: "Tự động quét và import tài khoản DeepSeek từ 9Router (~/.n9router/db.json)...",
              method: "auto" as const,
              async callback() {
                try {
                  const res = await importDeepSeekFrom9Router({ manager });
                  if (res.accounts.length > 0) {
                    const first = res.accounts[0];
                    return {
                      type: "success" as const,
                      provider: PROVIDER_ID,
                      refresh: first.refreshToken,
                      access: first.accessToken || "",
                      expires: first.expiresAt || Date.now() + 3600_000,
                      accountId: first.accountId,
                    };
                  }
                  const accounts = manager.list("deepseek");
                  const active = accounts[0];
                  if (active) {
                    return {
                      type: "success" as const,
                      provider: PROVIDER_ID,
                      refresh: active.refreshToken,
                      access: active.accessToken || "",
                      expires: active.expiresAt || Date.now() + 3600_000,
                      accountId: active.accountId,
                    };
                  }
                  return { type: "failed" as const };
                } catch (err) {
                  logger.error(`9Router DeepSeek import error: ${(err as Error).message}`);
                  return { type: "failed" as const };
                }
              },
            };
          },
        },
      ],
    },
  };
};

export default {
  id: PROVIDER_ID,
  server: plugin,
};
