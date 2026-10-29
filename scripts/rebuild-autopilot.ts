#!/usr/bin/env bun
/**
 * Durable hand-off between source pre-analysis and the reconstruction supervisor.
 * It retries only missing blueprints and never edits product files itself.
 */
import { appendFile, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

function arg(name: string) { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function args(name: string) { return process.argv.flatMap((v, i) => v === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]] : []); }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function run(command: string, commandArgs: string[], cwd: string) {
  return await new Promise<number>((resolve) => {
    const child = spawn(command, commandArgs, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const target = arg("target"); const source = arg("source");
  if (!target || !source) throw new Error("--target and --source are required");
  const root = path.resolve(target); const statePath = path.join(root, ".rebuild-supervisor", "state.json");
  const logFile = path.join(root, ".rebuild-supervisor", "autopilot.log");
  const toolRoot = path.dirname(new URL(import.meta.url).pathname);
  const concurrency = arg("analysis-concurrency") ?? "3";
  const timeout = arg("analysis-timeout-minutes") ?? "35";
  const models = args("analysis-model");
  const waitPid = Number(arg("wait-for-pid") ?? 0);
  const report = async (message: string) => { const line = `[${new Date().toISOString()}] ${message}\n`; process.stdout.write(line); await appendFile(logFile, line); };

  if (waitPid > 0) {
    await report(`waiting for existing analysis PID ${waitPid}`);
    while (true) { try { process.kill(waitPid, 0); await sleep(30_000); } catch { break; } }
  }
  while (true) {
    const state = JSON.parse(await readFile(statePath, "utf8")) as { tasks: Array<{ id: string; status: string }> };
    const pending = state.tasks.filter((task) => task.status === "pending");
    const blueprintDir = path.join(root, ".rebuild-supervisor", "pre-analysis");
    const blueprints = existsSync(blueprintDir) ? new Set((await readdir(blueprintDir)).filter((file) => file.endsWith(".md")).map((file) => file.slice(0, -3))) : new Set<string>();
    const missing = pending.filter((task) => !blueprints.has(task.id));
    if (!missing.length) break;
    await report(`pre-analysis retry for ${missing.length} missing leaf blueprint(s): ${missing.map((task) => task.id).join(", ")}`);
    const analysisArgs = [path.join(toolRoot, "pre-analyze-tasks.ts"), "--target", root, "--source", path.resolve(source), "--concurrency", concurrency, "--timeout-minutes", timeout, ...models.flatMap((model) => ["--model", model])];
    const code = await run("bun", analysisArgs, toolRoot);
    if (code !== 0) { await report(`pre-analysis exited ${code}; retrying missing leaf blueprints in 60 seconds`); await sleep(60_000); }
  }
  await report("all pending source blueprints exist; starting build/review supervisor resume");
  const resumeCode = await run("bun", [path.join(toolRoot, "rebuild-supervisor.ts"), "resume", "--target", root, "--max-cycles", "0", "--timeout-minutes", arg("timeout-minutes") ?? "90"], toolRoot);
  await report(`supervisor resume exited ${resumeCode}`);
  process.exitCode = resumeCode;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
