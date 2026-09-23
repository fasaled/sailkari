import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ProviderConfig {
  apiKey?: string;
  endpoint?: string;
  driverType?: "jev" | "openai-compatible";
  models?: string[];
  description?: string;
}

export interface SailkariConfig {
  modelPath?: string;
  systemPromptPath?: string;
  commandHistory?: string[];
  apiKeys?: Record<string, string>;
  providers?: Record<string, ProviderConfig>;
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
      ...(parsed.providers && typeof parsed.providers === "object" && !Array.isArray(parsed.providers) ? {
        providers: Object.fromEntries(
          Object.entries(parsed.providers)
            .filter(([k, v]) => typeof k === "string" && v && typeof v === "object")
            .map(([k, v]) => {
              const p = v as ProviderConfig;
              return [
                k,
                {
                  ...(typeof p.apiKey === "string" ? { apiKey: p.apiKey } : {}),
                  ...(typeof p.endpoint === "string" ? { endpoint: p.endpoint } : {}),
                  ...(p.driverType === "jev" || p.driverType === "openai-compatible" ? { driverType: p.driverType } : {}),
                  ...(Array.isArray(p.models) ? { models: p.models.filter((m): m is string => typeof m === "string") } : {}),
                  ...(typeof p.description === "string" ? { description: p.description } : {}),
                },
              ];
            })
        ),
      } : {}),
    };
  } catch {
    return {};
  }
}

let savePromiseChain: Promise<void> = Promise.resolve();

export async function saveConfig(config: SailkariConfig, path = getConfigPath()): Promise<void> {
  savePromiseChain = savePromiseChain.then(async () => {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(temporaryPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    await rename(temporaryPath, path);
  }).catch((err) => {
    // Avoid breaking the chain on failure
    console.error("Failed to save config:", err);
  });

  return savePromiseChain;
}
