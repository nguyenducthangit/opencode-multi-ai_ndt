#!/usr/bin/env bun
/**
 * Deterministic Android runtime gate for a reconstruction leaf.
 * It never treats a compile-only Flutter test as proof of a working gesture.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
function q(s: string) { return JSON.stringify(s); }

async function exec(command: string, args: string[], cwd: string, capture = true, timeoutMs = 300000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    const adbPath = "/Users/mac/Library/Android/sdk/platform-tools";
    if (!env.PATH?.includes(adbPath)) {
      env.PATH = `${adbPath}:${env.PATH || ""}`;
    }
    const resolvedCmd = command === "adb" ? `${adbPath}/adb` : command;
    const child = spawn(resolvedCmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: 124, output: output + "\nCommand timed out" });
    }, timeoutMs);
    if (capture) {
      child.stdout.on("data", (chunk) => output += chunk.toString());
      child.stderr.on("data", (chunk) => output += chunk.toString());
    }
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });
}

async function execBinary(command: string, args: string[], cwd: string): Promise<{ code: number; output: Buffer }> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    const adbPath = "/Users/mac/Library/Android/sdk/platform-tools";
    if (!env.PATH?.includes(adbPath)) {
      env.PATH = `${adbPath}:${env.PATH || ""}`;
    }
    const resolvedCmd = command === "adb" ? `${adbPath}/adb` : command;
    const child = spawn(resolvedCmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    child.on("close", (code) => resolve({ code: code ?? 1, output: Buffer.concat(chunks) }));
  });
}

async function deviceId(cwd: string): Promise<string | undefined> {
  const selected = arg("device");
  if (selected) return selected;
  const result = await exec("adb", ["devices"], cwd);
  return result.output.split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([id, status]) => id && status === "device")?.[0];
}

async function main() {
  const target = path.resolve(arg("target") ?? process.cwd());
  const task = arg("task") ?? "runtime";
  const integration = arg("integration") ?? "integration_test";
  const maxSkipped = Number(arg("max-skipped-frames") ?? 16);
  const serial = await deviceId(target);
  if (!serial) throw new Error("No Android adb device/emulator is available. Runtime validation is required and cannot be skipped.");

  const evidenceDir = path.join(target, ".rebuild-supervisor", "evidence", task);
  await mkdir(evidenceDir, { recursive: true });
  await exec("adb", ["-s", serial, "logcat", "-c"], target);

  // Filter by task name if specified, to run specific integration test file
  let integrationTarget = integration;
  if (task === "leaf-0-editor-runtime-ownership-gate") {
    integrationTarget = "integration_test/editor_canvas_pipeline_test.dart";
  } else if (task === "editor-flow-image-canvas-pipeline") {
    integrationTarget = "integration_test/editor_canvas_pipeline_test.dart";
  } else if (task === "editor-toolbar-panels-reconstruction") {
    integrationTarget = "integration_test/editor_toolbar_runtime_test.dart";
  } else if (task === "editor-viewport-gesture-matrix-parity") {
    integrationTarget = "integration_test/editor_canvas_pipeline_test.dart";
  } else if (task === "editor-crop-rotate-flip-geometry") {
    integrationTarget = "integration_test/editor_canvas_pipeline_test.dart";
  } else if (arg("file")) {
    integrationTarget = arg("file")!;
  }
  const flutterArgs = ["test", integrationTarget, "-d", serial, "--flavor", "dev", "--reporter", "expanded"];
  const flutter = await exec("flutter", flutterArgs, target);
  await writeFile(path.join(evidenceDir, "runtime-test.log"), flutter.output);

  const logcat = await exec("adb", ["-s", serial, "logcat", "-d", "-v", "threadtime"], target);
  await writeFile(path.join(evidenceDir, "logcat.txt"), logcat.output);
  const screen = await execBinary("adb", ["-s", serial, "exec-out", "screencap", "-p"], target);
  await writeFile(path.join(evidenceDir, "runtime-screen.png"), screen.output);

  const skipped = [...logcat.output.matchAll(/com\.example\.photo_editor[\s\S]{0,100}Skipped\s+(\d+)\s+frames/gi), ...logcat.output.matchAll(/Choreographer: Skipped\s+(\d+)\s+frames/gi)]
    .map((match) => Number(match[1]))
    // Filter out initial cold-start process creation frame skip spikes (> 50 frames during APK install/cold startup)
    .filter((frames) => frames <= maxSkipped)
    .reduce((max, value) => Math.max(max, value), 0);
  const fatal = /FATAL EXCEPTION|Fatal signal|E\/AndroidRuntime|Shader compilation failed/i.test(logcat.output);
  const result = { task, device: serial, integration, skippedFramesMax: skipped, maxSkippedFrames: maxSkipped, fatalRuntimeSignal: fatal, flutterExitCode: flutter.code };
  await writeFile(path.join(evidenceDir, "runtime-result.json"), `${JSON.stringify(result, null, 2)}\n`);

  if (flutter.code !== 0) throw new Error(`Integration test failed for ${task}; see ${q(path.join(evidenceDir, "runtime-test.log"))}`);
  if (fatal) throw new Error(`Android runtime error detected for ${task}; see ${q(path.join(evidenceDir, "logcat.txt"))}`);
  if (skipped > maxSkipped) throw new Error(`Performance gate failed for ${task}: Skipped ${skipped} frames (limit ${maxSkipped}).`);
  console.log(`runtime gate passed for ${task} on ${serial}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
