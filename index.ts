/**
 * OpenCode plugin entry for the whole package.
 *
 * Config may list a single path/package:
 *   "plugin": ["/absolute/path/to/opencode-multi-ai"]
 *   "plugin": ["opencode-multi-ai"]
 *
 * OpenCode's loader walks named exports and loads every `{ id, server }`
 * PluginModule. There is intentionally NO default export — a default would
 * short-circuit to only one provider.
 *
 * Per-provider modules remain the canonical PluginModules:
 *   lib/plugin/xai.ts         → id: xai-multi
 *   lib/plugin/codex.ts       → id: codex-multi
 *   lib/plugin/kiro.ts        → id: kiro-multi
 *   lib/plugin/antigravity.ts → id: antigravity-multi
 *   lib/plugin/opencode-go.ts → id: opencode-go-multi
 *   lib/plugin/deepseek.ts    → id: deepseek-multi
 */
export { default as xai } from "./lib/plugin/xai.js";
export { default as codex } from "./lib/plugin/codex.js";
export { default as kiro } from "./lib/plugin/kiro.js";
export { default as antigravity } from "./lib/plugin/antigravity.js";
export { default as opencodeGo } from "./lib/plugin/opencode-go.js";
export { default as deepseek } from "./lib/plugin/deepseek.js";

import { ensureAntigravityProxyRunning } from "./lib/providers/antigravity/proxy/local-proxy.js";

export default {
  id: "opencode-multi-ai",
  setup: async (_context: any) => {
    // Automatically ensure the multi-account Antigravity local proxy is running on port 41414
    await ensureAntigravityProxyRunning(41414);
  },
};
