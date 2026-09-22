import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SailkariConfig {
  modelPath?: string;
  systemPromptPath?: string;
  commandHistory?: string[];
  apiKeys?: Record<string, string>;
}

export function getConfigPath(): string {
  return join(homedir(), ".config", "sailkari", "config.json");
}

export async function loadConfig(path = getConfigPath()): Promise<SailkariConfig> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as SailkariConfig;
    return {
      ...(typeof parsed.modelPath === "string" ? { modelPath: parsed.modelPath } : {}),
      ...(typeof parsed.systemPromptPath === "string" ? { systemPromptPath: parsed.systemPromptPath } : {}),
      ...(Array.isArray(parsed.commandHistory) ? { commandHistory: parsed.commandHistory.filter((entry): entry is string => typeof entry === "string") } : {}),
      ...(parsed.apiKeys && typeof parsed.apiKeys === "object" && !Array.isArray(parsed.apiKeys) ? {
        apiKeys: Object.fromEntries(
          Object.entries(parsed.apiKeys).filter(([k, v]) => typeof k === "string" && typeof v === "string")
        ),
      } : {}),
    };
  } catch {
    return {};
  }
}

export async function saveConfig(config: SailkariConfig, path = getConfigPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  await rename(temporaryPath, path);
}
