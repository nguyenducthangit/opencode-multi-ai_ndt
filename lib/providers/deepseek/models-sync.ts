import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEEPSEEK_DEFAULT_MODELS,
  defaultModelsCachePath,
  type DeepSeekModelEntry,
} from "./constants.js";

type CacheFile = {
  updatedAt: number;
  models: Record<string, DeepSeekModelEntry>;
};

async function readCache(
  cachePath: string,
): Promise<Record<string, DeepSeekModelEntry> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(cachePath, "utf8"));
    if (
      value !== null &&
      typeof value === "object" &&
      "models" in value &&
      value.models !== null &&
      typeof value.models === "object"
    ) {
      return value.models as Record<string, DeepSeekModelEntry>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function writeDeepSeekModelsCache(
  models: Record<string, DeepSeekModelEntry>,
  cachePath = defaultModelsCachePath(),
): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const payload: CacheFile = { updatedAt: Date.now(), models };
  await writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function resolveDeepSeekMultiModels(opts?: {
  userModels?: Record<string, unknown>;
  allowNetwork?: boolean;
  cachePath?: string;
}): Promise<Record<string, unknown>> {
  void opts?.allowNetwork;
  const cachePath = opts?.cachePath ?? defaultModelsCachePath();
  const cached = await readCache(cachePath);
  const user = opts?.userModels ?? {};
  const resolved: Record<string, unknown> = {};

  for (const [id, defaultEntry] of Object.entries(DEEPSEEK_DEFAULT_MODELS)) {
    const cachedEntry = cached?.[id];
    const userEntry = user[id];

    let entry: Record<string, unknown> = { ...defaultEntry };
    if (cachedEntry && typeof cachedEntry === "object") {
      entry = { ...entry, ...cachedEntry };
    }
    if (
      userEntry !== null &&
      typeof userEntry === "object" &&
      !Array.isArray(userEntry)
    ) {
      entry = { ...entry, ...userEntry };
    }

    resolved[id] = entry;
  }

  // Preserve any custom user-added deepseek models
  for (const [id, userEntry] of Object.entries(user)) {
    if (
      !resolved[id] &&
      userEntry !== null &&
      typeof userEntry === "object" &&
      !Array.isArray(userEntry)
    ) {
      resolved[id] = userEntry;
    }
  }

  return resolved;
}
