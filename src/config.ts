import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SailkariConfig {
  modelPath?: string;
  systemPromptPath?: string;
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
