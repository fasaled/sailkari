import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultSecureStore, SecureCredentialStore } from "./secure-store.js";

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

export async function loadConfig(
  path = getConfigPath(),
  secureStore: SecureCredentialStore = defaultSecureStore
): Promise<SailkariConfig> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as SailkariConfig;
    const config: SailkariConfig = {
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

    // Auto-migrate legacy keys into secure store in background if present
    if (config.providers) {
      for (const [provider, p] of Object.entries(config.providers)) {
        if (p.apiKey?.trim()) {
          void secureStore.set(provider, p.apiKey.trim()).catch(() => {});
        }
      }
    }
    if (config.apiKeys) {
      for (const [provider, key] of Object.entries(config.apiKeys)) {
        if (key?.trim()) {
          void secureStore.set(provider, key.trim()).catch(() => {});
        }
      }
    }

    return config;
  } catch {
    return {};
  }
}

let savePromiseChain: Promise<void> = Promise.resolve();

export async function saveConfig(
  config: SailkariConfig,
  path = getConfigPath(),
  secureStore: SecureCredentialStore = defaultSecureStore
): Promise<void> {
  // 1. Sync credentials to secure storage if present
  if (config.providers) {
    for (const [provider, p] of Object.entries(config.providers)) {
      if (p.apiKey?.trim()) {
        await secureStore.set(provider, p.apiKey.trim()).catch(() => {});
      }
    }
  }
  if (config.apiKeys) {
    for (const [provider, key] of Object.entries(config.apiKeys)) {
      if (key?.trim()) {
        await secureStore.set(provider, key.trim()).catch(() => {});
      }
    }
  }

  // 2. Persist config file with 0600 permissions
  savePromiseChain = savePromiseChain.then(async () => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(temporaryPath, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    try {
      await chmod(temporaryPath, 0o600);
    } catch {
      // Ignored for environments without chmod support
    }
    await rename(temporaryPath, path);
    try {
      await chmod(path, 0o600);
    } catch {
      // Ignored
    }
  }).catch((err) => {
    // Avoid breaking the chain on failure
    console.error("Failed to save config:", err);
  });

  return savePromiseChain;
}
