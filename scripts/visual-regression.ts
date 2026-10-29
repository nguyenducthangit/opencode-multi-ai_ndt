#!/usr/bin/env bun
/** Compare two screenshots using ffmpeg PSNR and save a visual difference image. */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
function arg(name: string) { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
async function exec(args: string[]) { return await new Promise<{ code: number; out: string }>((resolve) => { const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] }); let out = ""; p.stdout.on("data", (b) => out += b); p.stderr.on("data", (b) => out += b); p.on("close", (code) => resolve({ code: code ?? 1, out })); }); }
async function main() {
  const expected = arg("expected"), actual = arg("actual"), out = arg("out"); if (!expected || !actual || !out) throw new Error("--expected, --actual and --out are required");
  const minPsnr = Number(arg("min-psnr") ?? 40); await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  const diff = await exec(["-y", "-i", expected, "-i", actual, "-filter_complex", "[0:v][1:v]blend=all_mode=difference", "-frames:v", "1", out]);
  const score = await exec(["-i", expected, "-i", actual, "-lavfi", "psnr", "-f", "null", "-"]);
  const match = score.out.match(/average:([\d.]+)/); const psnr = match ? Number(match[1]) : Number.NaN;
  console.log(JSON.stringify({ expected, actual, diff: path.resolve(out), psnr, minPsnr }, null, 2));
  if (diff.code !== 0 || !Number.isFinite(psnr) || psnr < minPsnr) process.exitCode = 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
