#!/usr/bin/env bun
/** Record a reproducible black-box Android scenario as screenshots + logcat. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

type Step = { action: "tap" | "swipe" | "text" | "wait" | "screenshot"; x?: number; y?: number; x2?: number; y2?: number; durationMs?: number; text?: string; name?: string };
type Scenario = { package?: string; activity?: string; steps: Step[] };
function arg(name: string) { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
async function run(args: string[]) { return await new Promise<{ code: number; out: Buffer }>((resolve) => { const p = spawn("adb", args, { stdio: ["ignore", "pipe", "pipe"] }); const chunks: Buffer[] = []; p.stdout.on("data", (b: Buffer) => chunks.push(Buffer.from(b))); p.stderr.on("data", (b: Buffer) => chunks.push(Buffer.from(b))); p.on("close", (code) => resolve({ code: code ?? 1, out: Buffer.concat(chunks) })); }); }
async function main() {
  const file = arg("scenario"); if (!file) throw new Error("--scenario <scenario.json> is required");
  const scenario = JSON.parse(await readFile(file, "utf8")) as Scenario;
  const device = arg("device") ?? ""; const prefix = device ? ["-s", device] : [];
  const outDir = path.resolve(arg("out") ?? `reference-runs/${Date.now()}`); await mkdir(outDir, { recursive: true });
  if ((await run([...prefix, "get-state"])).code !== 0) throw new Error("No adb device available");
  await run([...prefix, "logcat", "-c"]);
  if (scenario.package) await run([...prefix, "shell", "monkey", "-p", scenario.package, "1"]);
  if (scenario.activity && scenario.package) await run([...prefix, "shell", "am", "start", "-n", `${scenario.package}/${scenario.activity}`]);
  const manifest: Array<Record<string, unknown>> = [];
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i]; const label = `${String(i + 1).padStart(3, "0")}-${step.name ?? step.action}`;
    if (step.action === "tap") await run([...prefix, "shell", "input", "tap", String(step.x), String(step.y)]);
    if (step.action === "swipe") await run([...prefix, "shell", "input", "swipe", String(step.x), String(step.y), String(step.x2), String(step.y2), String(step.durationMs ?? 300)]);
    if (step.action === "text") await run([...prefix, "shell", "input", "text", step.text ?? ""]);
    if (step.action === "wait") await new Promise((resolve) => setTimeout(resolve, step.durationMs ?? 500));
    if (step.action === "screenshot" || step.action === "tap" || step.action === "swipe") { const shot = await run([...prefix, "exec-out", "screencap", "-p"]); await writeFile(path.join(outDir, `${label}.png`), shot.out); }
    manifest.push({ index: i, label, ...step });
  }
  const log = await run([...prefix, "logcat", "-d", "-v", "threadtime"]); await writeFile(path.join(outDir, "logcat.txt"), log.out);
  await writeFile(path.join(outDir, "scenario.json"), `${JSON.stringify({ scenario, manifest }, null, 2)}\n`);
  console.log(outDir);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
