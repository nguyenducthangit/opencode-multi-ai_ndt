#!/usr/bin/env bun
/** Create a queryable evidence index from a decompiled artifact tree. */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
function arg(name: string) { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }
const binaryExt = new Set([".so", ".mnn", ".tflite", ".onnx", ".bin", ".zip", ".db", ".sqlite", ".frag", ".glsl"]);
async function walk(root: string, out: string[]) { for (const entry of await readdir(root, { withFileTypes: true })) { if (entry.name.startsWith(".")) continue; const full = path.join(root, entry.name); if (entry.isDirectory()) await walk(full, out); else out.push(full); } }
async function main() {
  const source = arg("source"); const target = arg("target"); if (!source || !target) throw new Error("--source and --target are required");
  const files: string[] = []; await walk(path.resolve(source), files); const assets: string[] = []; const native: string[] = []; const leads: Array<{ file: string; matches: string[] }> = [];
  for (const file of files) { const ext = path.extname(file).toLowerCase(); const rel = path.relative(source, file); if (binaryExt.has(ext)) (ext === ".so" ? native : assets).push(rel); const meta = await stat(file); if (meta.size > 2_000_000 || ![".java", ".kt", ".smali", ".xml", ".json", ".txt", ".dart", ".frag", ".glsl"].includes(ext)) continue; const text = await readFile(file, "utf8").catch(() => ""); const matches = [...text.matchAll(/(?:System\.loadLibrary|native\s+\w+|https?:\/\/[^\s"']+|\.so\b|\.mnn\b|\.tflite\b|\.onnx\b|Retrofit|OkHttp|shader)/g)].map((m) => m[0]); if (matches.length) leads.push({ file: rel, matches: [...new Set(matches)].slice(0, 40) }); }
  // Keep the planner-facing index compact. The raw catalog remains available
  // for a targeted worker, but must never consume the entire planning context.
  const summary = { source: path.resolve(source), indexedAt: new Date().toISOString(), fileCount: files.length, native, assets, leadCount: leads.length, leads: leads.slice(0, 300), fullCatalog: "native-index-full.json" };
  const full = { source: path.resolve(source), indexedAt: new Date().toISOString(), fileCount: files.length, native, assets, leads };
  const out = path.join(path.resolve(target), ".rebuild-supervisor", "intelligence"); await mkdir(out, { recursive: true }); await writeFile(path.join(out, "native-index.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(out, "native-index-full.json"), `${JSON.stringify(full, null, 2)}\n`);
  await writeFile(path.join(out, "native-index.md"), `# Native intelligence index\n\nFiles: ${files.length}\n\nTotal leads: ${leads.length}; planner summary is capped at 300. Query native-index-full.json by feature path when needed.\n\n## Native libraries\n${native.map((x) => `- ${x}`).join("\n")}\n\n## Leads\n${summary.leads.map((x) => `- **${x.file}**: ${x.matches.join(", ")}`).join("\n")}`);
  console.log(path.join(out, "native-index.json"));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
