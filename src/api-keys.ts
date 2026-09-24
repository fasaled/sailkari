import type { ProviderConfig, SailkariConfig } from "./config.js";
import { defaultSecureStore, SecureCredentialStore } from "./secure-store.js";

export type DriverType = "jev" | "openai-compatible";

export interface ResolvedProvider {
  name: string;
  apiKey: string;
  keySource: "env" | "config" | "keychain";
  endpoint: string;
  endpointSource: "env" | "config" | "default";
  driverType: DriverType;
  driverTypeSource: "env" | "config" | "default";
  models: string[];
  modelsSource: "env" | "config" | "empty";
}

export interface CloudModelDefinition {
  id: string;
  provider: string;
  canonicalModel: string;
  driverType: DriverType;
  endpoint: string;
  description: string;
}

export interface ResolvedApiKey {
  key: string;
  source: "env" | "config" | "keychain";
}

export interface ProviderKeyStatus {
  provider: string;
  configured: boolean;
  source?: "env" | "config" | "keychain";
  maskedKey?: string;
  rawKey?: string;
  endpoint?: string;
  endpointSource?: "env" | "config" | "default";
  driverType?: DriverType;
  driverTypeSource?: "env" | "config" | "default";
  models: string[];
}

export function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

export function sanitizeEnvName(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function resolveApiKey(
  provider: string,
  config?: SailkariConfig
): ResolvedApiKey | undefined {
  const normalized = normalizeProvider(provider);
  const upper = sanitizeEnvName(normalized);

  // 1. Single direct env var: <PROVIDER>_API_KEY
  const directKey = process.env[`${upper}_API_KEY`];
  if (directKey?.trim()) return { key: directKey.trim(), source: "env" };

  // 2. Stored in config.providers
  if (config?.providers) {
    const p = config.providers[normalized];
    if (p?.apiKey?.trim()) {
      return { key: p.apiKey.trim(), source: "config" };
    }
  }

  // 3. Stored in legacy config.apiKeys
  if (config?.apiKeys) {
    const key = config.apiKeys[normalized];
    if (key?.trim()) {
      return { key: key.trim(), source: "config" };
    }
  }

  return undefined;
}

export async function resolveApiKeyAsync(
  provider: string,
  config?: SailkariConfig,
  secureStore: SecureCredentialStore = defaultSecureStore
): Promise<ResolvedApiKey | undefined> {
  const normalized = normalizeProvider(provider);
  const upper = sanitizeEnvName(normalized);

  // 1. Env var has highest precedence
  const directKey = process.env[`${upper}_API_KEY`];
  if (directKey?.trim()) return { key: directKey.trim(), source: "env" };

  // 2. Secure OS keychain / 0600 store
  try {
    const secureKey = await secureStore.get(normalized);
    if (secureKey?.trim()) {
      return { key: secureKey.trim(), source: "keychain" };
    }
  } catch {
    // Continue to config fallback
  }

  // 3. Fallback to synchronous config check
  return resolveApiKey(provider, config);
}

export function resolveProviderEndpoint(
  provider: string,
  config?: SailkariConfig,
  canonicalModel?: string
): { endpoint: string; source: "env" | "config" | "default" } {
  const normalized = normalizeProvider(provider);
  const upper = sanitizeEnvName(normalized);

  // 1. Single direct env var: <PROVIDER>_BASE_URL
  const envUrl = process.env[`${upper}_BASE_URL`];
  if (envUrl?.trim()) return { endpoint: envUrl.trim(), source: "env" };

  // 2. Stored in config.providers
  if (config?.providers) {
    const p = config.providers[normalized];
    if (p?.endpoint?.trim()) {
      return { endpoint: p.endpoint.trim(), source: "config" };
    }
  }

  // 3. Contextual heuristic fallback: if model is 'jev', use TypeSafe System One default URL, else standard OpenAI chat format
  if (canonicalModel?.toLowerCase().includes("jev")) {
    return { endpoint: "https://api.typesafe.ai/v1/systemone", source: "default" };
  }

  return { endpoint: "https://api.openai.com/v1/chat/completions", source: "default" };
}

export function resolveDriverType(
  provider: string,
  config?: SailkariConfig,
  canonicalModel?: string
): { driverType: DriverType; source: "env" | "config" | "default" } {
  const normalized = normalizeProvider(provider);
  const upper = sanitizeEnvName(normalized);

  // 1. Single direct env var: <PROVIDER>_DRIVER_TYPE
  const envType = process.env[`${upper}_DRIVER_TYPE`];
  if (envType?.trim()) {
    const val = envType.trim().toLowerCase();
    if (val === "jev" || val === "openai-compatible") {
      return { driverType: val, source: "env" };
    }
  }

  // 2. Config provider
  if (config?.providers) {
    const p = config.providers[normalized];
    if (p?.driverType) {
      return { driverType: p.driverType, source: "config" };
    }
  }

  // 3. Model name heuristic
  if (canonicalModel?.toLowerCase().includes("jev")) {
    return { driverType: "jev", source: "default" };
  }

  return { driverType: "openai-compatible", source: "default" };
}

export function resolveProviderModels(
  provider: string,
  config?: SailkariConfig
): { models: string[]; source: "env" | "config" | "empty" } {
  const normalized = normalizeProvider(provider);
  const upper = sanitizeEnvName(normalized);

  // 1. Single direct env var: <PROVIDER>_MODELS (comma separated)
  const envModels = process.env[`${upper}_MODELS`];
  if (envModels?.trim()) {
    const parsed = envModels
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
    return { models: parsed, source: "env" };
  }

  // 2. Config providers
  if (config?.providers) {
    const p = config.providers[normalized];
    if (p?.models && Array.isArray(p.models) && p.models.length > 0) {
      return { models: p.models, source: "config" };
    }
  }

  return { models: [], source: "empty" };
}

export function resolveProvider(
  provider: string,
  config?: SailkariConfig,
  canonicalModel?: string
): ResolvedProvider | undefined {
  const keyInfo = resolveApiKey(provider, config);
  if (!keyInfo) return undefined;

  const endpointInfo = resolveProviderEndpoint(provider, config, canonicalModel);
  const driverInfo = resolveDriverType(provider, config, canonicalModel);
  const modelsInfo = resolveProviderModels(provider, config);

  return {
    name: normalizeProvider(provider),
    apiKey: keyInfo.key,
    keySource: keyInfo.source,
    endpoint: endpointInfo.endpoint,
    endpointSource: endpointInfo.source,
    driverType: driverInfo.driverType,
    driverTypeSource: driverInfo.source,
    models: modelsInfo.models,
    modelsSource: modelsInfo.source,
  };
}

export function isCloudModel(target: string): boolean {
  const trimmed = target.trim();
  // Windows absolute paths like C:\path\to\model.gguf or D:/path/to/model.gguf
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return false;
  }
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex <= 0) return false;

  const providerCandidate = trimmed.slice(0, colonIndex);
  // Providers must be valid identifiers (letters, numbers, hyphens, underscores) with at least 2 chars
  return /^[a-zA-Z0-9_-]{2,}$/.test(providerCandidate);
}

export function getCloudModelDefinition(
  target: string,
  config?: SailkariConfig
): CloudModelDefinition | undefined {
  if (!isCloudModel(target)) return undefined;

  const trimmed = target.trim();
  const colonIndex = trimmed.indexOf(":");
  const provider = normalizeProvider(trimmed.slice(0, colonIndex));
  const model = trimmed.slice(colonIndex + 1).trim();
  if (!model) return undefined;

  const endpointInfo = resolveProviderEndpoint(provider, config, model);
  const driverInfo = resolveDriverType(provider, config, model);

  return {
    id: `${provider}:${model}`,
    provider,
    canonicalModel: model,
    driverType: driverInfo.driverType,
    endpoint: endpointInfo.endpoint,
    description: `${provider} model (${model})`,
  };
}

export function listConfiguredProviders(config?: SailkariConfig): string[] {
  const providers = new Set<string>();

  // From legacy apiKeys
  if (config?.apiKeys) {
    for (const p of Object.keys(config.apiKeys)) {
      providers.add(normalizeProvider(p));
    }
  }

  // From providers config
  if (config?.providers) {
    for (const p of Object.keys(config.providers)) {
      providers.add(normalizeProvider(p));
    }
  }

  // From environment variables: <PROVIDER>_API_KEY
  for (const envKey of Object.keys(process.env)) {
    if (envKey.endsWith("_API_KEY")) {
      const p = envKey.slice(0, -8).toLowerCase();
      if (p) providers.add(normalizeProvider(p));
    }
  }

  return Array.from(providers);
}

export function listCloudModels(config?: SailkariConfig): {
  id: string;
  provider: string;
  canonicalModel: string;
  available: boolean;
  source?: "env" | "config" | "keychain";
  endpoint: string;
  driverType: DriverType;
  description: string;
}[] {
  const allProviders = listConfiguredProviders(config);
  const result: {
    id: string;
    provider: string;
    canonicalModel: string;
    available: boolean;
    source?: "env" | "config" | "keychain";
    endpoint: string;
    driverType: DriverType;
    description: string;
  }[] = [];

  for (const p of allProviders) {
    const resolved = resolveProvider(p, config);
    if (!resolved) continue;

    for (const m of resolved.models) {
      result.push({
        id: `${resolved.name}:${m}`,
        provider: resolved.name,
        canonicalModel: m,
        available: true,
        source: resolved.keySource,
        endpoint: resolved.endpoint,
        driverType: resolved.driverType,
        description: `${resolved.name} model (${m})`,
      });
    }
  }

  return result;
}

export function setProviderInConfig(
  config: SailkariConfig,
  provider: string,
  options: {
    apiKey?: string;
    endpoint?: string;
    driverType?: DriverType;
    models?: string[];
    description?: string;
  }
): SailkariConfig {
  const normalized = normalizeProvider(provider);
  const existingProvider = config.providers?.[normalized] ?? {};

  const updatedProvider: ProviderConfig = {
    ...existingProvider,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey.trim() } : {}),
    ...(options.endpoint !== undefined ? { endpoint: options.endpoint.trim() } : {}),
    ...(options.driverType !== undefined ? { driverType: options.driverType } : {}),
    ...(options.models !== undefined ? { models: options.models.map((m) => m.trim()).filter((m) => m.length > 0) } : {}),
    ...(options.description !== undefined ? { description: options.description.trim() } : {}),
  };

  const nextProviders = {
    ...config.providers,
    [normalized]: updatedProvider,
  };

  let nextApiKeys = config.apiKeys;
  if (options.apiKey !== undefined) {
    nextApiKeys = {
      ...config.apiKeys,
      [normalized]: options.apiKey.trim(),
    };
  }

  return {
    ...config,
    providers: nextProviders,
    ...(nextApiKeys ? { apiKeys: nextApiKeys } : {}),
  };
}

export function addModelToProviderInConfig(
  config: SailkariConfig,
  provider: string,
  modelName: string
): SailkariConfig {
  const normalized = normalizeProvider(provider);
  const currentModels = config.providers?.[normalized]?.models ?? [];
  const trimmed = modelName.trim();
  if (!trimmed || currentModels.includes(trimmed)) return config;

  return setProviderInConfig(config, normalized, {
    models: [...currentModels, trimmed],
  });
}

export function removeModelFromProviderInConfig(
  config: SailkariConfig,
  provider: string,
  modelName: string
): SailkariConfig {
  const normalized = normalizeProvider(provider);
  const currentModels = config.providers?.[normalized]?.models ?? [];
  const trimmed = modelName.trim();
  if (!currentModels.includes(trimmed)) return config;

  return setProviderInConfig(config, normalized, {
    models: currentModels.filter((m) => m !== trimmed),
  });
}

export function setApiKeyInConfig(
  config: SailkariConfig,
  provider: string,
  key: string
): SailkariConfig {
  return setProviderInConfig(config, provider, { apiKey: key });
}

export function removeProviderFromConfig(
  config: SailkariConfig,
  provider: string,
  secureStore: SecureCredentialStore = defaultSecureStore
): { config: SailkariConfig; removed: boolean } {
  const normalized = normalizeProvider(provider);
  void secureStore.delete(normalized).catch(() => {});

  const hasInProviders = Boolean(config.providers && config.providers[normalized]);
  const hasInApiKeys = Boolean(config.apiKeys && config.apiKeys[normalized]);

  if (!hasInProviders && !hasInApiKeys) {
    return { config, removed: false };
  }

  const nextProviders = config.providers ? { ...config.providers } : undefined;
  if (nextProviders) {
    delete nextProviders[normalized];
  }

  const nextApiKeys = config.apiKeys ? { ...config.apiKeys } : undefined;
  if (nextApiKeys) {
    delete nextApiKeys[normalized];
  }

  return {
    config: {
      ...config,
      ...(nextProviders ? { providers: nextProviders } : {}),
      ...(nextApiKeys ? { apiKeys: nextApiKeys } : {}),
    },
    removed: true,
  };
}

export function removeApiKeyFromConfig(
  config: SailkariConfig,
  provider: string
): { config: SailkariConfig; removed: boolean } {
  return removeProviderFromConfig(config, provider);
}

export function getApiKeysStatus(config?: SailkariConfig): ProviderKeyStatus[] {
  const allProviders = listConfiguredProviders(config);

  const result: ProviderKeyStatus[] = [];
  for (const provider of allProviders) {
    const resolved = resolveProvider(provider, config);
    if (resolved) {
      result.push({
        provider,
        configured: true,
        source: resolved.keySource,
        maskedKey: maskApiKey(resolved.apiKey),
        rawKey: resolved.apiKey,
        endpoint: resolved.endpoint,
        endpointSource: resolved.endpointSource,
        driverType: resolved.driverType,
        driverTypeSource: resolved.driverTypeSource,
        models: resolved.models,
      });
    } else {
      const endpointInfo = resolveProviderEndpoint(provider, config);
      const driverInfo = resolveDriverType(provider, config);
      const modelsInfo = resolveProviderModels(provider, config);
      result.push({
        provider,
        configured: false,
        endpoint: endpointInfo.endpoint,
        endpointSource: endpointInfo.source,
        driverType: driverInfo.driverType,
        driverTypeSource: driverInfo.source,
        models: modelsInfo.models,
      });
    }
  }
  return result;
}
