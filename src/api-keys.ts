import type { SailkariConfig } from "./config.js";

export interface CloudModelDefinition {
  id: string;
  provider: string;
  canonicalModel: string;
  driverType: "jev" | "openai-compatible";
  endpoint?: string;
  description: string;
}

export const KNOWN_CLOUD_MODELS: Record<string, CloudModelDefinition> = {
  "jev": {
    id: "jev",
    provider: "typesafe",
    canonicalModel: "jev-latest",
    driverType: "jev",
    description: "TypeSafe Jev System One decision model",
  },
  "typesafe:jev": {
    id: "typesafe:jev",
    provider: "typesafe",
    canonicalModel: "jev-latest",
    driverType: "jev",
    description: "TypeSafe Jev System One decision model",
  },
  "typesafe:jev-latest": {
    id: "typesafe:jev-latest",
    provider: "typesafe",
    canonicalModel: "jev-latest",
    driverType: "jev",
    description: "TypeSafe Jev System One decision model (latest)",
  },
  "openai:gpt-4o-mini": {
    id: "openai:gpt-4o-mini",
    provider: "openai",
    canonicalModel: "gpt-4o-mini",
    driverType: "openai-compatible",
    endpoint: "https://api.openai.com/v1/chat/completions",
    description: "OpenAI GPT-4o mini",
  },
  "openai:gpt-4o": {
    id: "openai:gpt-4o",
    provider: "openai",
    canonicalModel: "gpt-4o",
    driverType: "openai-compatible",
    endpoint: "https://api.openai.com/v1/chat/completions",
    description: "OpenAI GPT-4o",
  },
  "groq:llama-3.3-70b-versatile": {
    id: "groq:llama-3.3-70b-versatile",
    provider: "groq",
    canonicalModel: "llama-3.3-70b-versatile",
    driverType: "openai-compatible",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    description: "Groq Llama 3.3 70B Versatile",
  },
  "groq:llama-3.1-8b-instant": {
    id: "groq:llama-3.1-8b-instant",
    provider: "groq",
    canonicalModel: "llama-3.1-8b-instant",
    driverType: "openai-compatible",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    description: "Groq Llama 3.1 8B Instant",
  },
};

export const KNOWN_PROVIDERS = ["typesafe", "jev", "openai", "groq", "openrouter"] as const;

export function normalizeProvider(provider: string): string {
  const lower = provider.trim().toLowerCase();
  if (lower === "jev") return "typesafe";
  return lower;
}

export interface ResolvedApiKey {
  key: string;
  source: "env" | "config";
}

function parseJsonEnvKeys(): Record<string, string> {
  const envVal = process.env.SAILKARI_API_KEYS;
  if (!envVal) return {};
  try {
    const parsed = JSON.parse(envVal);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k === "string" && typeof v === "string") {
          result[normalizeProvider(k)] = v;
        }
      }
      return result;
    }
  } catch {
    // Ignore JSON parse errors in env
  }
  return {};
}

export function resolveApiKey(provider: string, config?: SailkariConfig): ResolvedApiKey | undefined {
  const normalized = normalizeProvider(provider);

  // 1. Direct provider environment variables
  if (normalized === "typesafe") {
    const key = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
    if (key?.trim()) return { key: key.trim(), source: "env" };
  } else if (normalized === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (key?.trim()) return { key: key.trim(), source: "env" };
  } else if (normalized === "groq") {
    const key = process.env.GROQ_API_KEY;
    if (key?.trim()) return { key: key.trim(), source: "env" };
  } else if (normalized === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    if (key?.trim()) return { key: key.trim(), source: "env" };
  }

  // 2. Sailkari prefixed env variable: SAILKARI_KEY_<PROVIDER>
  const envKey = process.env[`SAILKARI_KEY_${normalized.toUpperCase()}`];
  if (envKey?.trim()) {
    return { key: envKey.trim(), source: "env" };
  }

  // 3. SAILKARI_API_KEYS JSON env variable
  const jsonEnvKeys = parseJsonEnvKeys();
  if (jsonEnvKeys[normalized]?.trim()) {
    return { key: jsonEnvKeys[normalized]!.trim(), source: "env" };
  }

  // 4. Stored in config.json
  if (config?.apiKeys) {
    const key = config.apiKeys[normalized] ?? config.apiKeys[provider.trim().toLowerCase()];
    if (key?.trim()) {
      return { key: key.trim(), source: "config" };
    }
  }

  return undefined;
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function isCloudModel(target: string): boolean {
  const normalized = target.trim().toLowerCase();
  if (KNOWN_CLOUD_MODELS[normalized]) return true;

  return (
    normalized.startsWith("openai:") ||
    normalized.startsWith("groq:") ||
    normalized.startsWith("openrouter:") ||
    normalized.startsWith("typesafe:")
  );
}

export function getCloudModelDefinition(target: string): CloudModelDefinition | undefined {
  const normalized = target.trim().toLowerCase();
  if (KNOWN_CLOUD_MODELS[normalized]) {
    return KNOWN_CLOUD_MODELS[normalized];
  }

  const colonIndex = target.indexOf(":");
  if (colonIndex > 0) {
    const provider = normalizeProvider(target.slice(0, colonIndex));
    const model = target.slice(colonIndex + 1).trim();

    if (provider === "typesafe") {
      return {
        id: target,
        provider: "typesafe",
        canonicalModel: model || "jev-latest",
        driverType: "jev",
        description: `TypeSafe Jev model (${model})`,
      };
    }

    if (provider === "openai") {
      return {
        id: target,
        provider: "openai",
        canonicalModel: model,
        driverType: "openai-compatible",
        endpoint: "https://api.openai.com/v1/chat/completions",
        description: `OpenAI model (${model})`,
      };
    }

    if (provider === "groq") {
      return {
        id: target,
        provider: "groq",
        canonicalModel: model,
        driverType: "openai-compatible",
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        description: `Groq model (${model})`,
      };
    }

    if (provider === "openrouter") {
      return {
        id: target,
        provider: "openrouter",
        canonicalModel: model,
        driverType: "openai-compatible",
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        description: `OpenRouter model (${model})`,
      };
    }
  }

  return undefined;
}

export function listCloudModels(config?: SailkariConfig): {
  id: string;
  provider: string;
  available: boolean;
  source?: "env" | "config";
  description: string;
}[] {
  return Object.values(KNOWN_CLOUD_MODELS).map((def) => {
    const resolved = resolveApiKey(def.provider, config);
    return {
      id: def.id,
      provider: def.provider,
      available: Boolean(resolved),
      source: resolved?.source,
      description: def.description,
    };
  });
}

export function setApiKeyInConfig(
  config: SailkariConfig,
  provider: string,
  key: string
): SailkariConfig {
  const normalized = normalizeProvider(provider);
  return {
    ...config,
    apiKeys: {
      ...config.apiKeys,
      [normalized]: key.trim(),
    },
  };
}

export function removeApiKeyFromConfig(
  config: SailkariConfig,
  provider: string
): { config: SailkariConfig; removed: boolean } {
  const normalized = normalizeProvider(provider);
  if (!config.apiKeys || (!config.apiKeys[normalized] && !config.apiKeys[provider.trim().toLowerCase()])) {
    return { config, removed: false };
  }
  const nextKeys = { ...config.apiKeys };
  delete nextKeys[normalized];
  delete nextKeys[provider.trim().toLowerCase()];
  return {
    config: {
      ...config,
      apiKeys: nextKeys,
    },
    removed: true,
  };
}

export interface ProviderKeyStatus {
  provider: string;
  configured: boolean;
  source?: "env" | "config";
  maskedKey?: string;
  rawKey?: string;
}

export function getApiKeysStatus(config?: SailkariConfig): ProviderKeyStatus[] {
  const allProviders = new Set<string>(["typesafe", "openai", "groq", "openrouter"]);
  if (config?.apiKeys) {
    for (const key of Object.keys(config.apiKeys)) {
      allProviders.add(normalizeProvider(key));
    }
  }

  const result: ProviderKeyStatus[] = [];
  for (const provider of allProviders) {
    const resolved = resolveApiKey(provider, config);
    result.push({
      provider,
      configured: Boolean(resolved),
      source: resolved?.source,
      maskedKey: resolved ? maskApiKey(resolved.key) : undefined,
      rawKey: resolved?.key,
    });
  }
  return result;
}
