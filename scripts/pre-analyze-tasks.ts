#!/usr/bin/env bun
/**
 * Parallel Reverse-Engineering Pre-Analysis Worker Pool.
 * Spawns background worker subagents to pre-analyze pending tasks
 * and generate exhaustive blueprints in .rebuild-supervisor/pre-analysis/<task-id>.md
 * before the main Builder Agent (Agent Mẹ) executes the build phase.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { ensureAntigravityProxyRunning } from "../lib/providers/antigravity/proxy/local-proxy.js";

type Task = { id: string; title: string; goal: string; status: "pending" | "done" | "blocked"; dependsOn?: string[] };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}
function args(name: string): string[] {
  return process.argv.flatMap((value, index) => value === `--${name}` && process.argv[index + 1] ? [process.argv[index + 1]] : []);
}

function q(s: string) {
  return JSON.stringify(s);
}

const targetArg = arg("target") ?? "/Users/mac/Documents/TOOL/jadx_custom/dich_nguoc/photo_editor";
const target = path.resolve(targetArg);
const sourceArg = arg("source") ?? "/Users/mac/Documents/TOOL/jadx_custom/dich_nguoc/photo_editor/dịchnguoc";
const concurrency = Number(arg("concurrency") ?? 2);
const timeoutMinutes = Math.max(5, Number(arg("timeout-minutes") ?? 35) || 35);
const onlyTaskId = arg("task");
const skippedTaskIds = new Set(args("skip-task"));
const models = args("model");
if (!models.length) models.push("antigravity-multi/gemini-3.8-flash-high");

const stateDir = path.join(target, ".rebuild-supervisor");
const preAnalysisDir = path.join(stateDir, "pre-analysis");
const logFile = path.join(preAnalysisDir, "pre-analysis.log");

mkdirSync(preAnalysisDir, { recursive: true });

async function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  await appendFile(logFile, line);
}

function buildAnalysisPrompt(task: Task): string {
  return `You are a specialized Senior Reverse-Engineering & Mathematical Analysis Subagent working on behalf of the main Builder Agent.
Target Project: ${q(target)}
Decompiled Ground Truth Source: ${q(sourceArg)}

YOUR GOAL: Perform deep, evidence-backed reverse engineering for upcoming task:
ID: ${task.id}
Title: ${task.title}
Goal: ${task.goal}

STRICT OPERATIONAL RULES:
1. READ-ONLY ANALYSIS: DO NOT edit or modify any Dart code in lib/. DO NOT run git commands.
2. SOURCE GROUND TRUTH: Inspect actual decompiled Java files in 'dịchnguoc/java_src/' or 'dịchnguoc/android_res/layout/' or 'dịchnguoc/deep_math_deobf_mapping.json' and 'dịchnguoc/semantic_deobf_mapping.json'.
3. NO PLACEHOLDERS / NO GUESSING: Every formula, coefficient, layout ID, and asset name must be traced to exact files and lines.
4. PRODUCE DROP-IN BLUEPRINT: Write your comprehensive findings into:
${q(path.join(preAnalysisDir, `${task.id}.md`))}

BLUEPRINT SECTIONS REQUIRED IN THE OUTPUT FILE:
# BLUEPRINT: ${task.id} — ${task.title}
1. Native Java/C++ Source Mapping: Class names, method signatures, line numbers, and exact code snippets.
2. Layout & View Hierarchy: Layout XML names (res/layout/*.xml), view IDs, dimensions, default values, min/max ranges.
3. Assets, Resources & Decryption (.zip, AES-128, .mnn):
   - Exact SVG/PNG filenames in res/drawable*, color filters, and AppAssets mapping.
   - Resource packages (.zip, textures, models): specify if remote CDN download, AES-128-CBC key/IV, or local asset unpacking is needed.
4. Mathematical Formulas & Image DSP: Exact formulas (spline, 5-tap convolution matrix, HSL color rotation, Bilateral filter, Delaunay 106 mesh math, PatchMatch).
5. Current Code Audit & Gap Analysis (SOI LỖI MÃ NGUỒN HIỆN TẠI):
   - Inspect existing Dart files in '${target}/lib/features/editor/' and '${target}/lib/core/'.
   - ❌ What logic/formulas in the current project are WRONG, MOCK, INVERTED, or GUESSWORK.
   - ⚠️ What classes, files, or state observables are MISSING.
   - 🛠️ Exact required refactorings for the Builder Agent to achieve 100% parity.
6. Target Flutter Implementation Blueprint:
   - Target files in lib/features/editor/
   - GetX Controller actions & state observables
   - Production-ready Dart methods and classes (Clean Room implementation matching decompiled logic)
   - Unit test plan and test cases.

Exit cleanly once the blueprint is written to ${path.join(preAnalysisDir, `${task.id}.md`)}.`;
}

async function analyzeTask(task: Task, workerIndex: number): Promise<boolean> {
  const outputFile = path.join(preAnalysisDir, `${task.id}.md`);
  if (existsSync(outputFile)) {
    await log(`[SKIP] Pre-analysis already exists for ${task.id}`);
    return true;
  }

  const model = models[workerIndex % models.length];
  await log(`[START] Worker ${workerIndex + 1} analyzing ${task.id} with ${model}...`);
  const prompt = buildAnalysisPrompt(task);
  const args = ["run", "--standalone", "--auto", "--format", "json", "--model", model, prompt];

  return new Promise((resolve) => {
    const child = spawn("opencode", args, {
      cwd: target,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (v) => (output += v.toString()));
    child.stderr.on("data", (v) => (output += v.toString()));

    // A provider connection can remain open forever after sleep/network loss.
    // Bound each worker independently so one stalled task cannot freeze the queue.
    const timer = setTimeout(() => {
      void log(`[TIMEOUT] ${task.id} exceeded ${timeoutMinutes} minutes; terminating its worker process group`);
      try { process.kill(-child.pid!, "SIGTERM"); } catch {}
    }, timeoutMinutes * 60_000);
    child.on("close", async (code) => {
      clearTimeout(timer);
      if (code === 0 && existsSync(outputFile)) {
        await log(`[SUCCESS] Pre-analysis completed for ${task.id}`);
        resolve(true);
      } else {
        await log(`[FAIL] Pre-analysis exited with code ${code} for ${task.id}`);
        resolve(false);
      }
    });
  });
}

async function main() {
  await ensureAntigravityProxyRunning();
  await log(`Starting Pre-Analysis Worker Pool (Concurrency: ${concurrency}, timeout: ${timeoutMinutes}m, Models: ${models.join(", ")})`);

  const stateFile = path.join(stateDir, "state.json");
  const tasksFile = path.join(stateDir, "tasks.json");
  let tasks: Task[] = [];
  if (existsSync(stateFile)) {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    tasks = state.tasks ?? [];
  } else if (existsSync(tasksFile)) {
    tasks = JSON.parse(await readFile(tasksFile, "utf8"));
  }

  const pendingTasks = tasks.filter(
    (t) =>
      t.status === "pending" &&
      (!onlyTaskId || t.id === onlyTaskId) &&
      !skippedTaskIds.has(t.id) &&
      !existsSync(path.join(preAnalysisDir, `${t.id}.md`))
  );

  await log(`Found ${pendingTasks.length} pending tasks requiring pre-analysis: ${pendingTasks.map(t => t.id).join(", ")}`);

  // Process in worker batches with concurrency limit
  let failed = false;
  for (let i = 0; i < pendingTasks.length; i += concurrency) {
    const batch = pendingTasks.slice(i, i + concurrency);
    await log(`Processing batch: ${batch.map((t) => t.id).join(", ")}`);
    const outcomes = await Promise.all(batch.map((task, index) => analyzeTask(task, i + index)));
    failed ||= outcomes.some((outcome) => !outcome);
  }

  if (failed) throw new Error("One or more pre-analysis workers failed; refusing to claim source coverage.");
  await log("All pending tasks pre-analyzed successfully!");
}

main().catch(console.error);
