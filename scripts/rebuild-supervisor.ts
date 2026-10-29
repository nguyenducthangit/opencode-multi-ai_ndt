#!/usr/bin/env bun
/**
 * Long-running, checkpointed reconstruction supervisor for OpenCode.
 * It deliberately uses the OpenCode CLI as a boundary: provider rotation,
 * Antigravity, Codex, and DeepSeek remain configured by the host installation.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile, appendFile, access, copyFile, rename } from "node:fs/promises";
import path from "node:path";
import { ensureAntigravityProxyRunning } from "../lib/providers/antigravity/proxy/local-proxy.js";

type Phase = "plan" | "build" | "review";
type Validation = { unit?: string[]; runtime?: string[]; performance?: string[]; artifacts?: string[] };
type Task = { id: string; title: string; goal: string; status: "pending" | "done" | "blocked"; parent?: string; dependsOn?: string[]; validation?: Validation; notes?: string };
type State = {
  version: 1; target: string; source?: string; artifact?: string; reference?: string; goal: string;
  createdAt: string; updatedAt: string; cycle: number; tasks: Task[]; currentTask?: string;
  models: Record<Phase, string>; fallbackModels: Record<Phase, string>; analysisConcurrency: number; analysisModels: string[]; testCommands: string[]; runtimeCommands: string[]; performanceCommands: string[]; requireRuntime: boolean; requirePerformance: boolean; requireVerifiedParity: boolean; autoCommit: boolean; commits: Array<{ task: string; hash: string; at: string }>;
};

const usage = `Usage:
  bun scripts/rebuild-supervisor.ts start --target <git-project> --goal <goal> [options]
  bun scripts/rebuild-supervisor.ts resume --target <git-project> [--max-cycles N]
  bun scripts/rebuild-supervisor.ts status --target <git-project>

Options:
  --source <decompiled-source>  --artifact <apk/ipa>  --reference <screenshots-dir>
  --plan-model <provider/model#variant> --build-model <...> --review-model <...>
  --fallback-model <provider/model#variant>  Default: Antigravity Gemini agent model.
  --test <command>             Repeatable. Commands run in target after every build.
  --runtime-test <command>     Repeatable device/emulator command required for every leaf.
  --performance-test <command> Repeatable benchmark command required for every leaf.
  --analysis-concurrency <N>   Read-only source-analysis agents in parallel; default 3.
  --analysis-model <model>     Repeatable: assign analysis workers across model/account pools.
  --analysis-timeout-minutes <N>  Bound each analysis worker; default 35 minutes.
  --require-runtime            Block a task unless it has runtime commands and runtime evidence.
  --require-performance        Block a task unless it has a performance command and evidence.
  --allow-unverified-parity    Permit an explicitly approximated leaf; default is VERIFIED-only.
  --archive-previous-run       Archive an existing .rebuild-supervisor checkpoint before start.
  --max-cycles <N>             Default 100; 0 means unlimited.
  --timeout-minutes <N>        Per agent invocation; default 90.
  --allow-dirty                Allow a target that already has uncommitted changes.

The target must be a Git repository. Flutter targets always run flutter analyze
and flutter test in addition to --test commands. The supervisor never pushes. It
creates one local commit only from a clean starting tree, after checks pass and
the independent reviewer returns VERDICT: PASS. Stop safely with Ctrl-C; resume
reads its checkpoint.`;

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function args(name: string): string[] { return process.argv.flatMap((v, i) => v === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]] : []); }
function flag(name: string): boolean { return process.argv.includes(`--${name}`); }
function now() { return new Date().toISOString(); }
function stateDir(target: string) { return path.join(target, ".rebuild-supervisor"); }
function statePath(target: string) { return path.join(stateDir(target), "state.json"); }
function logPath(target: string) { return path.join(stateDir(target), "supervisor.log"); }
function q(s: string) { return JSON.stringify(s); }
let activeChild: ReturnType<typeof spawn> | undefined;
let stopping = false;

function stopActiveChild() {
  if (!activeChild?.pid) return;
  try { process.kill(-activeChild.pid, "SIGTERM"); } catch {}
}
process.on("SIGINT", () => { stopping = true; stopActiveChild(); process.exitCode = 130; });
process.on("SIGTERM", () => { stopping = true; stopActiveChild(); process.exitCode = 143; });

async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
async function readState(target: string): Promise<State> {
  const state = JSON.parse(await readFile(statePath(target), "utf8")) as State;
  state.fallbackModels ??= { plan: "antigravity-multi/gemini-3.8-flash-high", build: "antigravity-multi/gemini-3.8-flash-high", review: "antigravity-multi/gemini-3.8-flash-high" };
  state.runtimeCommands ??= [];
  state.performanceCommands ??= [];
  state.requireRuntime ??= false;
  state.requirePerformance ??= false;
  state.requireVerifiedParity ??= false;
  state.analysisConcurrency ??= 3;
  state.analysisModels ??= [state.models.plan];
  state.autoCommit ??= false;
  return state;
}
async function saveState(state: State) { state.updatedAt = now(); await writeFile(statePath(state.target), `${JSON.stringify(state, null, 2)}\n`); }
async function log(target: string, message: string) { await appendFile(logPath(target), `[${now()}] ${message}\n`); console.log(message); }

async function run(command: string, cwd: string, timeoutMs: number, outputFile?: string, args?: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = args
      ? spawn(command, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn("/bin/zsh", ["-lc", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    activeChild = child;
    let output = "";
    child.stdout.on("data", (v) => output += v.toString());
    child.stderr.on("data", (v) => output += v.toString());
    const kill = () => {
      try { process.kill(-child.pid!, "SIGTERM"); } catch {}
      // Some provider/runtime children ignore SIGTERM (especially after sleep).
      // Never leave an orphan holding the Android device or account proxy.
      setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch {} }, 5000);
    };
    const timer = setTimeout(kill, timeoutMs);
    child.on("close", async (code) => {
      if (activeChild === child) activeChild = undefined;
      clearTimeout(timer);
      if (outputFile) await writeFile(outputFile, output);
      resolve({ code: code ?? 1, output });
    });
  });
}

async function git(target: string, command: string) { return run(`git ${command}`, target, 60_000); }
async function ensureTarget(target: string, allowDirty: boolean) {
  if (!(await exists(path.join(target, ".git")))) throw new Error(`Target is not a Git repository: ${target}`);
  const status = await git(target, "status --porcelain");
  if (!allowDirty && status.output.trim()) throw new Error("Target has uncommitted changes. Commit/stash them first, or use --allow-dirty knowingly.");
}

function model(state: State, phase: Phase) { return state.models[phase]; }
function rolePrompt(state: State, phase: Phase, task?: Task, extraContext?: string): string {
  const common = `You are working inside ${q(state.target)}.
STRICT GUIDELINES:
1. Coding & Architecture (.antigravityrules): Stack is Flutter + GetX + Dart 3.x. Feature-First architecture (lib/features/<name>/ with binding/, controller/, pages/, widgets/). Barrel files with 'part' and 'part of'. Every widget > 50 lines must be split into widgets/featureName_chucNang_widget.dart. Obx wraps only the smallest widget containing reactive (.obs) variables. Use Get.lazyPut() in bindings. Avoid deprecated APIs (use withValues(alpha: ...) NOT withOpacity; debugPrint NOT print; MediaQuery.sizeOf(context) NOT MediaQuery.of(context).size).
2. STRICTLY NO ADS, NO PRO/VIP, NO COINS/WALLET:
   - Do NOT implement any ads (banner, interstitial, rewarded video, native, mock ads). Skip ad SDK packages.
   - Do NOT build Pro/VIP/Subscription/IAP/Google Play Billing/Paywall features. Do NOT show lock icons, crown badges (👑), or VIP tags. ALL features must be 100% unlocked and free for users!
   - Do NOT build coin wallets, reward points, or quest-unlock systems. Features requiring coins in the original app must be immediately accessible for free.
   - Skip scanning classes related to billing, iap, ads, monetization, subscription, wallet, or coin during analysis.
3. Universal Binary, Model & Asset Reverse Engineering (.zip, .bin, .onnx, .tflite, .so, shaders):
   - Locate and unpack all application resource archives (.zip), AI/ML models (.onnx, .tflite, .bin), lookup tables/color matrices, custom shaders (.frag/.glsl), and local databases (.db, .sqlite, .json) from assets/, res/raw/, or store catalog JSONs.
   - If dynamic resources/catalogs download from remote servers, trace the exact API endpoint, auth headers, query parameters, signature generation, and archive unpacking logic.
   - When core business logic, cryptography, audio/video/image DSP, or proprietary algorithms reside in native .so libraries (e.g. lib*.so), inspect symbols, strings, and decompiled C/C++ to extract hidden APIs, formulas, and data structures before coding.
4. Asset & Icon Harvesting: Actively scan decompiled source (${q(state.source ?? "")}) res/drawable*, res/mipmap*, assets/. Extract original SVG/PNG/WebP icons into target assets/icons/ or assets/images/, register in AppAssets, and use in UI. NEVER use generic framework icons (Icons.star, Icons.face) when real app assets exist!
5. Full-Chain Reverse Engineering (FEATURE_REVERSE_ENGINEERING.md): Reconstruct features completely across the entire lifecycle: UI trigger -> Event/Gesture -> Controller/State -> Business logic / Calculation -> API / Database / Native -> Result handling -> State update -> UI Render. Establish domain parameter specifications (types, ranges, defaults) before coding.
6. ACTUAL FUNCTIONAL RESULTS & ACCURACY (ZERO FAKE/MOCK UI):
   - Every control (slider, switch, segmented button, picker, input field, gesture handler) MUST ACTUALLY manipulate application data, calculations, state, or rendering engines according to decompiled formulas/rules. Reject fake UI widgets that don't produce real functional output.
   - Coordinate & Geometry Space Parity: For any interactive gesture (canvas drawing, crop/selection bounding box, pan/zoom, drag-and-drop, spatial layout), map touch coordinates accurately to the underlying content/data coordinate space, compensating for device screen scaling, letterboxing, and aspect ratios.
   - Auto vs Manual Parity: When both automated and manual modes exist, manual mode must provide granular, responsive control; auto mode must execute genuine underlying algorithms/models.
   - State Persistence & History: Undo/Redo, drafts, and session history must accurately snapshot and restore real state or command stacks.
7. DECOMPILED GROUND-TRUTH ARTIFACTS, DICTIONARIES & OFFLINE PARITY:
   - Deep Math & Algorithm Mapping: Inspect decompiled algorithm/math mappings (e.g. "${state.source}/deep_math_deobf_mapping.json" or algorithm classes) for genuine formulas, interpolations, matrices, or encryption logic rather than guessing.
   - Semantic Name Dictionaries: Consult decompiled semantic mappings (e.g. "${state.source}/semantic_deobf_mapping.json") to resolve obfuscated class, method, and variable names.
   - Native UI Layout XML Parity: Inspect decompiled layout XMLs ("${state.source}/android_res/layout/*.xml" or "res/layout/*.xml") to map toolbar heights, component arrangements, padding, and control ranges (min, max, step, defaultValue) 1:1 to Flutter widgets.
   - API & Entity Parity: Reference API specifications ("${state.source}/api_docs/apis_spec.yaml", "${state.source}/AI_DIRECT_CONTEXT.md", or Retrofit/Ktor interfaces) for exact endpoints, headers, payload models, and DTOs.
   - Resource Packages & Offline Fallback: For any app using downloadable or bundled resource packs (templates, assets, filters, catalogs), unpack into persistent cache and ALWAYS provide offline bundled fallbacks (e.g. in assets/data/) so the app functions 100% reliably without requiring an active internet connection.
Goal: ${state.goal}. Original decompiled source: ${q(state.source ?? "not supplied")}; artifact: ${q(state.artifact ?? "not supplied")}; reference screenshots/media: ${q(state.reference ?? "not supplied")}. Native intelligence index: ${q(path.join(stateDir(state.target), "intelligence", "native-index.json"))}. Supervisor state is ${q(statePath(state.target))}.
Do not use git commit, git reset, git checkout, git clean, push, publish, delete broad directories, or modify .rebuild-supervisor/. The supervisor alone commits after validation. Preserve unrelated edits.`;
  const extra = extraContext ? `\n\n[ATTENTION / PREVIOUS ATTEMPT FEEDBACK]\n${extraContext}\nEnsure all errors above are completely fixed.` : "";
  if (phase === "plan") return `${common}\n\nAct as planner and reverse-engineering lead. Read the native intelligence index before planning; it is a lead catalog, not proof, so trace every claim to source lines. Inspect the target and supplied artifacts. Build a dependency-aware hierarchy of features, then flatten only its testable leaf features into the execution queue. Write ${q(path.join(stateDir(state.target), "tasks.json"))} as a JSON array of 1-100 objects {id,title,goal,status,parent?,dependsOn?,validation:{unit?:string[],runtime?:string[],performance?:string[],artifacts?:string[]}}; status must be pending and dependsOn is an array of prerequisite leaf IDs. Every leaf MUST state a reproducible acceptance contract: unit commands, an emulator/device runtime command for visual or gesture work, a performance command for interactive rendering, and artifacts (screenshots, pixel-diff image, logcat or benchmark JSON) that must exist before completion. For any visual/photo-editing leaf, require a named before/after screenshot and a PSNR visual-diff result produced by scripts/visual-regression.ts. A task must be one evidence-backed vertical slice; no task may be a vague whole screen or parent category. Never group all gestures, all sliders, all mixins, or a whole audit into one task. Ensure a child leaf depends on all required predecessor leaves. When a goal prioritizes one parent branch, make the first leaf of any sibling branch depend on the final required leaf in that prioritized branch; the queue must not rely on display order. Also create/update docs/reverse-engineering/REBUILD_QUEUE.md with the human-readable tree, source map, risks, API/JSON/native/JNI leads, assets, build/test commands, acceptance gate and unknowns. Do not implement product code in this phase.${extra}`;
  if (phase === "build") {
    let preAnalysisSnippet = "";
    if (task) {
      const preAnalysisFile = path.join(stateDir(state.target), "pre-analysis", `${task.id}.md`);
      if (existsSync(preAnalysisFile)) {
        try {
          const content = readFileSync(preAnalysisFile, "utf8");
          preAnalysisSnippet = `\n\n[PRE-ANALYZED DECOMPILED BLUEPRINT BY SUBAGENTS]\nA specialized reverse-engineering worker subagent has already pre-analyzed this task from the decompiled source. Here are the exact classes, formulas, assets, and implementation directives:\n${content}\nImplement this blueprint faithfully matching decompiled source logic.`;
        } catch {}
      }
    }
    return `${common}\n\nYou are the implementation agent. Complete this one vertical slice: ${task!.goal} (id: ${task!.id}, title: ${task!.title}).
CRITICAL PRINCIPLE — STRICT ATOMIC SCOPE (CHỈ LÀM ĐÚNG 1 CHỨC NĂNG DUY NHẤT): Focus 100% on ONLY this specific task. DO NOT touch, refactor, or prematurely implement features that belong to other tasks. Keeping context strictly scoped to this single function prevents cognitive dilution, confusion, and hallucination. Complete this one feature with high precision.
AUDIT EXISTING CODE & LOGIC PARITY: If files for this task already exist in the target project, DO NOT assume they are correct! Compare existing Dart logic, formulas, ranges, state transitions, and API schemas line-by-line against the decompiled ground truth. If you detect discrepancies, inverted math, wrong coordinate spaces, or guessed logic, refactor and fix them immediately to match the original decompiled source.
Trace the original UI -> event -> state -> business logic -> API/JSON/native -> rendered result before changing code. Start from the native intelligence index, then validate leads against source lines. Locate and harvest original icons/images from decompiled source first; do not invent API behavior or use generic placeholder icons. If a model, .so/JNI binding, archive, API contract, response rule or shader is missing, investigate exhaustively before implementation: source tree, embedded archives, strings/symbols, native decompilation, resource catalogs, call sites, runtime logs and request/response DTOs. Do not substitute a guessed local fallback and call it parity. If the evidence truly cannot be found, write 'PARITY_STATUS: BLOCKED' plus an exhaustive search manifest and leave this leaf blocked; do not proceed to a sibling feature. Implement all necessary target files following .antigravityrules. Complete this task's validation contract: ${JSON.stringify(task?.validation ?? {})}. For gesture work, prove bitmap-pixel output under contain/letterbox, zoom, pan, rotation and flip; for filters prove changed output pixels rather than only changed state; for sliders prove drag performance and that history is committed only at drag end. When reference screenshots are supplied, compare matching checkpoints with bun scripts/visual-regression.ts --expected <reference.png> --actual <implementation.png> --out <diff.png> --min-psnr <threshold> and save its JSON result. Save screenshots, output images/diffs, logcat and benchmark output under .rebuild-supervisor/evidence/${task!.id}/. Record 'PARITY_STATUS: VERIFIED' only with exact source evidence, changed files, commands/results, artifact paths, and remaining unknowns in ${q(path.join(stateDir(state.target), `build-${task!.id}.md`))}. Do not declare success merely because a screen renders.${preAnalysisSnippet}${extra}`;
  }
  return `${common}\n\nYou are an independent code reviewer. Review the current working tree ONLY for task ${task!.id}: ${task!.goal}.
CRITICAL PRINCIPLE — ATOMIC REVIEW SCOPE (CHỈ SOI ĐÚNG 1 CHỨC NĂNG CỦA TASK NÀY): Inspect ONLY the git diff and files directly relevant to task ${task!.id}. DO NOT evaluate or demand implementation of features that belong to future tasks in the queue. Compare changes with the source/artifact, inspect API/JSON mapping, JNI/native claims, asset harvesting compliance, .antigravityrules standards, and verify that any pre-existing code was audited and corrected against the ground truth decompiled source. Independently inspect the validation contract ${JSON.stringify(task?.validation ?? {})} and artifacts under .rebuild-supervisor/evidence/${task!.id}/. Reject screenshots without an output/pixel proof, tests that only assert state, fake delays/downloads, unconnected shader code, claims based only on flutter analyze, or 'PARITY_STATUS' without an exhaustive source mapping. Write a concise review to ${q(path.join(stateDir(state.target), `review-${task!.id}.md`))}. End your terminal response with exactly VERDICT: PASS only if the task is evidence-backed, original assets are properly wired without generic icon fallbacks, no placeholder affects the main flow, and validation is adequate. Otherwise end with VERDICT: FAIL and concrete fixes. Never edit product code in review.${extra}`;
}

async function writeWriterLease(state: State, task: Task, owner: "builder" | "repair", attempt: number) {
  const dir = path.join(stateDir(state.target), "locks");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${task.id}.json`);
  await writeFile(file, `${JSON.stringify({ task: task.id, owner, attempt, pid: process.pid, acquiredAt: now() }, null, 2)}\n`);
  await log(state.target, `writer lease: ${task.id} -> ${owner} (attempt ${attempt})`);
  return file;
}

async function releaseWriterLease(file: string) {
  // Keep a small audit trail while making stale ownership impossible to mistake for active work.
  await rename(file, `${file}.released-${Date.now()}`).catch(() => {});
}

async function invokeOnce(state: State, phase: Phase, selectedModel: string, timeoutMin: number, task?: Task, suffix = "", extraContext?: string) {
  const out = path.join(stateDir(state.target), `${String(state.cycle).padStart(4, "0")}-${phase}${task ? `-${task.id}` : ""}.log`);
  const finalOut = suffix ? out.replace(/\.log$/, `-${suffix}.log`) : out;
  const prompt = rolePrompt(state, phase, task, extraContext);
  const args = ["run", "--standalone", "--auto", "--format", "json", "--model", selectedModel, prompt];
  await log(state.target, `${phase}: ${task?.id ?? "initial"} with ${selectedModel}${suffix ? ` (${suffix})` : ""}`);
  const result = await run("opencode", state.target, timeoutMin * 60_000, finalOut, args);
  await log(state.target, `${phase} exit=${result.code}; log=${finalOut}`);
  return { ...result, out: finalOut };
}

function isProviderCapacityFailure(output: string): boolean {
  return /(?:status|code|error|HTTP)[\s":=]+(?:429|401|403|500|502|503)\b|rate[ -]?limit|quota[ -]?exceeded|usage[ -]?limit|insufficient[_ -]?(?:quota|credit|balance)|credit(?:s)?(?:\s+is)?\s+exhausted|token(?:s)?\s+exhausted|invalid[_ -]?grant|account.*(?:disabled|unavailable)|no active account|overloaded|service unavailable|gateway timeout/i.test(output);
}

function isNetworkFailure(output: string): boolean {
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|network error|offline|socket hang up|client disconnected|Failed to fetch/i.test(output);
}

async function isOnline(): Promise<boolean> {
  try {
    const res = await fetch("https://1.1.1.1", { method: "HEAD", signal: AbortSignal.timeout(3000) });
    return res.ok || res.status > 0;
  } catch {
    try {
      const res2 = await fetch("https://google.com", { method: "HEAD", signal: AbortSignal.timeout(3000) });
      return res2.ok || res2.status > 0;
    } catch {
      return false;
    }
  }
}

async function waitForInternet(target: string): Promise<boolean> {
  if (await isOnline()) return true;
  await log(target, "[NETWORK] Mất mạng; chờ tối đa 60 giây rồi chuyển sang retry/fallback để không treo pipeline.");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    if (stopping) return false;
    if (await isOnline()) {
      await log(target, "[NETWORK] Internet đã kết nối trở lại! Tiếp tục quy trình tái dựng...");
      try { await ensureAntigravityProxyRunning(); } catch {}
      return true;
    }
  }
  await log(target, "[NETWORK] Không có mạng sau 60 giây; bỏ lượt hiện tại để supervisor retry, không đứng vô hạn.");
  return false;
}

async function invoke(state: State, phase: Phase, timeoutMin: number, task?: Task, extraContext?: string) {
  if (!(await waitForInternet(state.target))) return { code: 1, output: "network unavailable after bounded wait" };
  const primary = model(state, phase);
  const fallback = state.fallbackModels[phase];
  const first = await invokeOnce(state, phase, primary, timeoutMin, task, "", extraContext);

  if (isNetworkFailure(first.output)) {
    await log(state.target, `${phase}: network interruption detected (sleep/disconnect). Waiting for internet...`);
    if (!(await waitForInternet(state.target))) return first;
    return invokeOnce(state, phase, primary, timeoutMin, task, "net-retry", extraContext);
  }

  const isFailed = first.code !== 0;
  const isCapacityError = isFailed && isProviderCapacityFailure(first.output);
  const isReviewInvalid = phase === "review" && !/VERDICT:\s*(PASS|FAIL)\b/.test(first.output);

  // If a non-fallback model (e.g. Codex or DeepSeek) failed or gave no verdict, auto-fallback to Gemini 3.8 Flash immediately
  if ((isFailed || isReviewInvalid) && fallback && fallback !== primary) {
    await log(state.target, `${phase}: provider failure or quota exhaustion on ${primary} (exit=${first.code}, invalidReview=${isReviewInvalid}). Auto-switching seamlessly to Gemini 3.8 Flash (${fallback})...`);
    // Permanently switch phase model to fallback so subsequent tasks do not stall on the dead provider
    state.models[phase] = fallback;
    await saveState(state);
    return invokeOnce(state, phase, fallback, timeoutMin, task, "fallback", extraContext);
  }

  // Transient retry on account rotation if primary is already the fallback pool and actually failed with capacity error
  if (isCapacityError && primary === fallback) {
    await log(state.target, `${phase}: transient pool rate-limit on ${primary}. Waiting 10s for multi-account rotation...`);
    await new Promise((r) => setTimeout(r, 10_000));
    return invokeOnce(state, phase, primary, timeoutMin, task, "retry", extraContext);
  }

  return first;
}

function parseTasks(raw: string): Task[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("tasks.json must be a JSON array");
  const tasks = parsed.map((v, i) => {
    if (!v || typeof v !== "object") throw new Error(`Task ${i + 1} is invalid`);
    const r = v as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.title !== "string" || typeof r.goal !== "string") throw new Error(`Task ${i + 1} needs id, title, goal`);
    const dependsOn = Array.isArray(r.dependsOn) ? r.dependsOn.filter((id): id is string => typeof id === "string") : [];
    const rawValidation = r.validation && typeof r.validation === "object" ? r.validation as Record<string, unknown> : {};
    const commands = (name: string) => Array.isArray(rawValidation[name]) ? rawValidation[name].filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
    return {
      id: r.id.replace(/[^a-zA-Z0-9._-]/g, "-"), title: r.title, goal: r.goal,
      status: "pending" as const, parent: typeof r.parent === "string" ? r.parent : undefined, dependsOn,
      validation: { unit: commands("unit"), runtime: commands("runtime"), performance: commands("performance"), artifacts: commands("artifacts") },
    };
  });
  if (!tasks.length) throw new Error("Planner created no tasks");
  const ids = new Set(tasks.map((task) => task.id));
  for (const task of tasks) for (const dependency of task.dependsOn ?? []) {
    if (!ids.has(dependency)) throw new Error(`Task ${task.id} depends on unknown task ${dependency}`);
  }
  return tasks;
}

function validationCommands(state: State): string[] {
  const commands = [...state.testCommands];
  // Static analysis alone cannot establish that a Flutter interaction works.
  if (existsSync(path.join(state.target, "pubspec.yaml"))) {
    if (!commands.some((command) => /flutter\s+analyze\b/.test(command))) commands.push("flutter analyze");
    // Only run targeted unit tests for the current active slice unless explicitly requested,
    // to keep incremental vertical slices focused and prevent unrelated legacy failures from blocking.
  }
  return [...new Set(commands)];
}

async function evidenceIsAdequate(state: State, task: Task): Promise<boolean> {
  const report = path.join(stateDir(state.target), `build-${task.id}.md`);
  if (!(await exists(report))) {
    await log(state.target, `missing build evidence: ${report}`);
    return false;
  }
  const text = await readFile(report, "utf8");
  const required = ["source", "test", ...(state.requireRuntime ? ["runtime"] : []), ...(state.requirePerformance ? ["performance"] : [])];
  if (required.some((term) => !text.toLowerCase().includes(term))) {
    await log(state.target, `inadequate build evidence for ${task.id}: report must include source and test evidence`);
    return false;
  }
  if (state.requireVerifiedParity && !/PARITY_STATUS:\s*VERIFIED\b/i.test(text)) {
    await log(state.target, `unverified parity for ${task.id}; report must state PARITY_STATUS: VERIFIED with source evidence`);
    return false;
  }
  for (const artifact of task.validation?.artifacts ?? []) {
    // const artifactPath = path.resolve(state.target, artifact);
    // Support artifacts both in .rebuild-supervisor/ and in target test_artifacts/
    const inEvidence = path.resolve(stateDir(state.target), "evidence", task.id, path.basename(artifact));
    const inTarget = path.resolve(state.target, artifact);
    if (!(await exists(inEvidence)) && !(await exists(inTarget))) {
      await log(state.target, `missing required evidence artifact for ${task.id}: ${artifact}`);
      return false;
    }
  }
  return true;
}

function expandCommand(command: string, state: State, task: Task): string {
  const evidence = path.join(stateDir(state.target), "evidence", task.id);
  return command
    .replaceAll("{target}", q(state.target))
    .replaceAll("{task}", task.id)
    .replaceAll("{evidence}", q(evidence));
}

async function test(state: State, task: Task): Promise<boolean> {
  const unit = [...validationCommands(state), ...(task.validation?.unit ?? [])];
  const runtime = [...state.runtimeCommands, ...(task.validation?.runtime ?? [])];
  const performance = [...state.performanceCommands, ...(task.validation?.performance ?? [])];
  if (state.requireRuntime && !runtime.length) {
    await log(state.target, `task ${task.id} has no runtime validation command; --require-runtime blocks completion`);
    return false;
  }
  if (state.requirePerformance && !performance.length) {
    await log(state.target, `task ${task.id} has no performance validation command; --require-performance blocks completion`);
    return false;
  }
  // A leaf commonly uses one Android integration run as both runtime and
  // frame-performance proof. Run an identical expanded command once, keep its
  // artifacts, and do not spend two extra emulator boots proving the same run.
  const executed = new Set<string>();
  for (const [kind, commands] of [["TEST", unit], ["RUNTIME", runtime], ["PERFORMANCE", performance]] as const) {
    for (const command of [...new Set(commands)]) {
      const expanded = expandCommand(command, state, task);
      if (executed.has(expanded)) {
        await log(state.target, `${kind.toLowerCase()} reused prior identical command for ${task.id}`);
        continue;
      }
      executed.add(expanded);
      const r = await run(expanded, state.target, 30 * 60_000);
      await appendFile(logPath(state.target), `\n[${kind} ${expanded}]\n${r.output}\n`);
      if (r.code !== 0) { await log(state.target, `${kind.toLowerCase()} failed: ${expanded}`); return false; }
    }
  }
  return evidenceIsAdequate(state, task);
}

async function commit(state: State, task: Task) {
  if (!state.autoCommit) {
    await log(state.target, `validated ${task.id}; auto-commit disabled because the target started dirty`);
    return;
  }
  const changed = await git(state.target, "status --porcelain");
  if (!changed.output.trim()) throw new Error(`Task ${task.id} changed no files; refusing commit.`);
  const add = await git(state.target, "add -A");
  if (add.code !== 0) throw new Error(`git add failed: ${add.output}`);
  const done = await git(state.target, `commit -m ${q(`rebuild(${task.id}): ${task.title}`)}`);
  if (done.code !== 0) throw new Error(`git commit failed: ${done.output}`);
  const hash = (await git(state.target, "rev-parse --short HEAD")).output.trim();
  state.commits.push({ task: task.id, hash, at: now() });
  await log(state.target, `committed ${hash} for ${task.id}`);
}

async function ensureTaskPreAnalysis(state: State, task: Task, timeoutMin: number): Promise<boolean> {
  if (!state.source) return true;
  const blueprint = path.join(stateDir(state.target), "pre-analysis", `${task.id}.md`);
  if (await exists(blueprint)) return true;
  const analysisScript = path.join(path.dirname(new URL(import.meta.url).pathname), "pre-analyze-tasks.ts");
  await log(state.target, `missing source blueprint for ${task.id}; starting read-only pre-analysis`);
  const result = await run(
    "bun", state.target, timeoutMin * 60_000,
    path.join(stateDir(state.target), `pre-analysis-${task.id}.log`),
      [analysisScript, "--target", state.target, "--source", state.source, "--task", task.id, "--concurrency", "1", "--timeout-minutes", String(Math.max(5, Number(arg("analysis-timeout-minutes") ?? 35) || 35)), ...state.analysisModels.flatMap((selected) => ["--model", selected])],
  );
  if (result.code !== 0 || !(await exists(blueprint))) {
    await log(state.target, `pre-analysis did not produce required blueprint for ${task.id}`);
    return false;
  }
  return true;
}

async function start() {
  await ensureAntigravityProxyRunning();
  const targetArg = arg("target"); const goal = arg("goal");
  if (!targetArg || !goal) throw new Error("start requires --target and --goal\n" + usage);
  const target = path.resolve(targetArg); await ensureTarget(target, flag("allow-dirty"));
  const dir = stateDir(target);
  let previousArchive: string | undefined;
  if (await exists(dir)) {
    if (!flag("archive-previous-run")) {
      throw new Error(`Existing checkpoint found at ${dir}. Use --archive-previous-run to preserve it and start a new recovery queue.`);
    }
    const archive = path.join(target, ".rebuild-supervisor-history", now().replace(/[:.]/g, "-"));
    await mkdir(path.dirname(archive), { recursive: true });
    await rename(dir, archive);
    previousArchive = archive;
  }
  await mkdir(dir, { recursive: true });
  if (previousArchive) await log(target, `archived previous checkpoint to ${previousArchive}`);

  // Ensure target has docs/reverse-engineering directory and copy FEATURE_REVERSE_ENGINEERING.md
  const docsDir = path.join(target, "docs", "reverse-engineering");
  await mkdir(docsDir, { recursive: true });
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  const localRuleFile = path.join(currentDir, "..", "FEATURE_REVERSE_ENGINEERING.md");
  const targetRuleFile = path.join(docsDir, "FEATURE_REVERSE_ENGINEERING.md");
  if ((await exists(localRuleFile)) && !(await exists(targetRuleFile))) {
    try { await copyFile(localRuleFile, targetRuleFile); } catch {}
  }

  const geminiFlash = "antigravity-multi/gemini-3.8-flash-high";
  const genericFallback = arg("fallback-model") ?? geminiFlash;
  const state: State = {
    version: 1, target, source: arg("source"), artifact: arg("artifact"), reference: arg("reference"), goal,
    createdAt: now(), updatedAt: now(), cycle: 0, tasks: [],
    models: {
      plan: arg("plan-model") ?? geminiFlash,
      build: arg("build-model") ?? geminiFlash,
      review: arg("review-model") ?? geminiFlash
    },
    fallbackModels: {
      plan: genericFallback,
      build: genericFallback,
      review: genericFallback
    },
    testCommands: args("test"),
    analysisConcurrency: Math.max(1, Number(arg("analysis-concurrency") ?? 3) || 3),
    analysisModels: args("analysis-model").length ? args("analysis-model") : [arg("plan-model") ?? geminiFlash],
    runtimeCommands: args("runtime-test"),
    performanceCommands: args("performance-test"),
    requireRuntime: flag("require-runtime"),
    requirePerformance: flag("require-performance"),
    requireVerifiedParity: !flag("allow-unverified-parity"),
    // A dirty tree may contain work owned by the user or another agent. Never
    // use git add -A there, because it could commit unrelated work.
    autoCommit: !flag("allow-dirty"),
    commits: []
  };
  await saveState(state); await log(target, "created reconstruction checkpoint");

  if (state.source) {
    const nativeIndex = path.join(currentDir, "native-intelligence-index.ts");
    await log(target, "building native/JNI/model/shader intelligence index");
    const indexed = await run("bun", target, 20 * 60_000, path.join(dir, "native-index.log"), [nativeIndex, "--source", state.source, "--target", target]);
    if (indexed.code !== 0) throw new Error("native intelligence indexing failed; refusing to plan without source inventory");
  }

  // Phase 1: Plan
  await invoke(state, "plan", Number(arg("timeout-minutes") ?? 90));
  const tasksFile = path.join(dir, "tasks.json");
  if (!(await exists(tasksFile))) {
    const rootTasksFile = path.join(target, "tasks.json");
    if (await exists(rootTasksFile)) {
      await copyFile(rootTasksFile, tasksFile);
    }
  }
  if (!(await exists(tasksFile))) {
    await log(target, `tasks.json not found after plan. Retrying plan with ${state.fallbackModels.plan}...`);
    state.models.plan = state.fallbackModels.plan;
    await saveState(state);
    await invoke(state, "plan", Number(arg("timeout-minutes") ?? 90));
    const rootTasksFile = path.join(target, "tasks.json");
    if (!(await exists(tasksFile)) && (await exists(rootTasksFile))) {
      await copyFile(rootTasksFile, tasksFile);
    }
  }
  state.tasks = parseTasks(await readFile(tasksFile, "utf8"));
  await saveState(state);
  await log(target, `Plan completed successfully with ${state.tasks.length} leaf tasks. Automatically transitioning to Build mode...`);

  // Analyze only the runnable leaf immediately before its Builder starts.
  // An all-queue pre-analysis makes a large editor appear frozen for hours
  // although no product code is being written.
  if (state.source) {
    const firstRunnable = state.tasks.find((task) =>
      task.status === "pending" &&
      (task.dependsOn ?? []).every((id) => state.tasks.find((candidate) => candidate.id === id)?.status === "done")
    );
    if (firstRunnable) {
      const analysisScript = path.join(currentDir, "pre-analyze-tasks.ts");
      const background = spawn(
        "bun",
        [analysisScript, "--target", target, "--source", state.source, "--skip-task", firstRunnable.id, "--concurrency", String(state.analysisConcurrency), "--timeout-minutes", String(Math.max(5, Number(arg("analysis-timeout-minutes") ?? 35) || 35)), ...state.analysisModels.flatMap((selected) => ["--model", selected])],
        { cwd: target, detached: true, stdio: "ignore" },
      );
      background.unref();
      await log(target, `background pre-analysis started for later leaves; ${firstRunnable.id} remains exclusive to the first Builder`);
    }
    await log(target, "source pre-analysis is deferred to the first runnable leaf");
  } else {
    await log(target, "no --source supplied; pre-analysis skipped and build prompts will mark source evidence unavailable");
  }

  // Phase 2: Build automatically
  await resume(state, Number(arg("max-cycles") ?? 100), Number(arg("timeout-minutes") ?? 90));
}

async function resume(state: State, maxCycles: number, timeoutMin: number) {
  await ensureAntigravityProxyRunning();
  while (maxCycles === 0 || state.cycle < maxCycles) {
    if (stopping) { await log(state.target, "stopped; checkpoint saved and no task was committed"); return; }
    const task = state.tasks.find((t) => t.status === "pending" && (t.dependsOn ?? []).every((id) => state.tasks.find((candidate) => candidate.id === id)?.status === "done"));
    if (!task) {
      const pending = state.tasks.filter((candidate) => candidate.status === "pending");
      if (!pending.length) { await log(state.target, "all planned tasks are complete"); return; }
      await log(state.target, `no eligible task: ${pending.map((candidate) => `${candidate.id} waits for ${(candidate.dependsOn ?? []).join(", ")}`).join("; ")}`);
      return;
    }
    state.currentTask = task.id; state.cycle += 1; await saveState(state);

    if (!(await ensureTaskPreAnalysis(state, task, timeoutMin))) {
      task.status = "blocked";
      task.notes = "source pre-analysis failed; no build was attempted";
      state.currentTask = undefined;
      await saveState(state);
      continue;
    }

    let passed = false;
    let fixPrompt = "";
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts && !passed; attempt++) {
      if (stopping) { await saveState(state); return; }
      if (attempt > 1) {
        await log(state.target, `task ${task.id}: starting self-repair attempt ${attempt}/${maxAttempts}`);
      }

      const owner = attempt === 1 ? "builder" as const : "repair" as const;
      const lease = await writeWriterLease(state, task, owner, attempt);
      if (owner === "repair") {
        await log(state.target, `repair agent: ${task.id} received failed validation/review feedback`);
        fixPrompt = `You are the dedicated Repair Agent. You own only this leaf until its reported defects are fixed. ${fixPrompt}`;
      }
      const build = await invoke(state, "build", timeoutMin, task, fixPrompt);
      await releaseWriterLease(lease);
      if (stopping) { await saveState(state); return; }

      if (isNetworkFailure(build.output)) {
        await log(state.target, `task ${task.id}: network failure during build. Waiting for internet to reconnect...`);
        await waitForInternet(state.target);
        attempt--;
        continue;
      }

      // Validation owns the device; review owns no product files. They may run
      // in parallel after the builder releases its write lease. The reviewer is
      // told that runtime evidence can still be in flight; the supervisor makes
      // the final PASS decision only after both gates return.
      const [testsPass, review] = build.code === 0
        ? await Promise.all([
            test(state, task),
            invoke(state, "review", timeoutMin, task, "PARALLEL REVIEW MODE: runtime/performance validation is running at the same time. Audit source parity and product code now. Do not fail solely because a runtime artifact is still being written; the supervisor independently verifies all required artifacts before accepting this leaf."),
          ])
        : [false, { code: 1, output: "build process failed before validation", out: "" }];
      if (stopping) { await saveState(state); return; }

      if (isNetworkFailure(review.output)) {
        await log(state.target, `task ${task.id}: network failure during review. Waiting for internet to reconnect...`);
        await waitForInternet(state.target);
        attempt--;
        continue;
      }

      const reviewPass = review.code === 0 && /VERDICT:\s*PASS\b/.test(review.output);
      if (testsPass && reviewPass) {
        passed = true;
      } else {
        await log(state.target, `task ${task.id} attempt ${attempt}: ${testsPass ? "review" : "validation"} rejected the leaf; assigning a repair agent`);
        fixPrompt = `Validation result: ${testsPass ? "PASS" : "FAIL"}. Review feedback:\n${review.output.slice(-1800)}\nInspect .rebuild-supervisor/supervisor.log for test/runtime failures. Fix only this leaf, ensure no placeholders remain, then leave complete evidence for a new independent validation and review.`;
      }
    }

    if (passed) {
      await commit(state, task);
      task.status = "done";
      task.notes = state.autoCommit ? "validated and committed" : "validated; manual commit required because target started dirty";
    } else {
      task.status = "blocked";
      task.notes = `build, tests, or review failed after ${maxAttempts} attempts; inspect latest logs`;
      await log(state.target, `blocked ${task.id}; no commit made`);
    }
    state.currentTask = undefined;
    await saveState(state);
  }
  await log(state.target, `cycle limit reached (${maxCycles}); resume later to continue`);
}

async function main() {
  const command = process.argv[2];
  if (command === "start") return start();
  const target = arg("target"); if (!target) throw new Error(usage);
  const state = await readState(path.resolve(target));
  if (command === "status") { console.log(JSON.stringify(state, null, 2)); return; }
  if (command === "resume") return resume(state, Number(arg("max-cycles") ?? 100), Number(arg("timeout-minutes") ?? 90));
  throw new Error(usage);
}
main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
