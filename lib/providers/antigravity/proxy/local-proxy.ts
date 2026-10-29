import http from "node:http";
import { getAccountManager } from "../../../core/accounts.js";
import { logger } from "../../../core/logger.js";
import { createProviderFetch } from "../../../core/provider-fetch.js";
import { createAntigravityAdapter } from "../adapter.js";

export const DEFAULT_ANTIGRAVITY_PROXY_PORT = 41414;

let activeServer: http.Server | undefined;

export async function isProxyHealthy(port = DEFAULT_ANTIGRAVITY_PROXY_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function startAntigravityProxy(port = DEFAULT_ANTIGRAVITY_PROXY_PORT): Promise<http.Server> {
  if (activeServer) {
    return activeServer;
  }

  const manager = getAccountManager();
  await manager.load();
  const adapter = createAntigravityAdapter();
  const customFetch = createProviderFetch(adapter, manager);

  const server = http.createServer(async (req, res) => {
    if (req.url === "/health" || req.url === "/ping") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", provider: "antigravity-multi", pool: manager.list("antigravity").length }));
      return;
    }

    if (req.method === "POST" && (req.url?.includes("/chat/completions") || req.url === "/")) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const body = Buffer.concat(chunks).toString("utf8");

      try {
        const upstream = await customFetch("https://cloudcode-pa.googleapis.com/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });

        res.writeHead(upstream.status, {
          "Content-Type": upstream.headers.get("content-type") || "text/event-stream; charset=utf-8",
          "Transfer-Encoding": "chunked",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        if (upstream.body) {
          for await (const chunk of upstream.body as AsyncIterable<Uint8Array>) {
            res.write(chunk);
          }
        }
        res.end();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Antigravity proxy error: ${message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message, type: "proxy_error" } }));
      }
      return;
    }

    // Default 404
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  return new Promise((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        logger.info(`Antigravity proxy port ${port} is already in use by another process.`);
        resolve(server);
      } else {
        reject(err);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      logger.info(`Antigravity local proxy running on http://127.0.0.1:${port}`);
      activeServer = server;
      server.unref(); // Do not prevent process exit when idle
      resolve(server);
    });
  });
}

export async function ensureAntigravityProxyRunning(port = DEFAULT_ANTIGRAVITY_PROXY_PORT): Promise<void> {
  const healthy = await isProxyHealthy(port);
  if (healthy) {
    return;
  }
  await startAntigravityProxy(port);
  // Wait up to 3 seconds for port to become healthy
  for (let i = 0; i < 15; i++) {
    if (await isProxyHealthy(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Standalone CLI runner: bun lib/providers/antigravity/proxy/local-proxy.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Starting standalone Antigravity local proxy on port ${DEFAULT_ANTIGRAVITY_PROXY_PORT}...`);
  await startAntigravityProxy(DEFAULT_ANTIGRAVITY_PROXY_PORT);
  console.log("Press Ctrl-C to terminate proxy.");
}
