import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  addModelToProviderInConfig,
  getApiKeysStatus,
  getCloudModelDefinition,
  isCloudModel,
  listCloudModels,
  maskApiKey,
  normalizeProvider,
  removeApiKeyFromConfig,
  removeModelFromProviderInConfig,
  removeProviderFromConfig,
  resolveApiKey,
  resolveProvider,
  resolveProviderEndpoint,
  setApiKeyInConfig,
  setProviderInConfig,
} from "./api-keys.js";
import type { SailkariConfig } from "./config.js";

describe("api-keys & providers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_BASE_URL;
    delete process.env.TYPESAFE_DRIVER_TYPE;
    delete process.env.TYPESAFE_MODELS;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_DRIVER_TYPE;
    delete process.env.OPENAI_MODELS;
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_BASE_URL;
    delete process.env.GROQ_DRIVER_TYPE;
    delete process.env.GROQ_MODELS;
    delete process.env.ZEN_API_KEY;
    delete process.env.ZEN_BASE_URL;
    delete process.env.ZEN_DRIVER_TYPE;
    delete process.env.ZEN_MODELS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("provider endpoint & driver resolution", () => {
    it("resolves default endpoint for jev when model is jev", () => {
      const endpoint = resolveProviderEndpoint("typesafe", undefined, "jev");
      expect(endpoint.endpoint).toBe("https://api.typesafe.ai/v1/systemone");
    });

    it("resolves custom endpoint from environment variable", () => {
      process.env.ZEN_BASE_URL = "https://zen.opencode.ai/api/v1";
      const endpoint = resolveProviderEndpoint("zen");
      expect(endpoint.endpoint).toBe("https://zen.opencode.ai/api/v1");
      expect(endpoint.source).toBe("env");
    });

    it("resolves custom endpoint from config", () => {
      const config: SailkariConfig = {
        providers: {
          zen: {
            endpoint: "https://zen.opencode.ai/v1",
          },
        },
      };
      const endpoint = resolveProviderEndpoint("zen", config);
      expect(endpoint.endpoint).toBe("https://zen.opencode.ai/v1");
      expect(endpoint.source).toBe("config");
    });

    it("resolves full provider with custom endpoint, driverType, models and apiKey", () => {
      process.env.ZEN_API_KEY = "zen-secret-key";
      process.env.ZEN_BASE_URL = "https://custom.zen/api";
      process.env.ZEN_DRIVER_TYPE = "jev";
      process.env.ZEN_MODELS = "jev,decision-v1";

      const provider = resolveProvider("zen");
      expect(provider).toBeDefined();
      expect(provider!.name).toBe("zen");
      expect(provider!.apiKey).toBe("zen-secret-key");
      expect(provider!.endpoint).toBe("https://custom.zen/api");
      expect(provider!.driverType).toBe("jev");
      expect(provider!.models).toEqual(["jev", "decision-v1"]);
      expect(provider!.modelsSource).toBe("env");
    });

    it("allows loading cloud model for arbitrary custom provider", () => {
      const config: SailkariConfig = {
        providers: {
          mygateway: {
            apiKey: "gw-key",
            endpoint: "https://gateway.internal/v1",
            driverType: "jev",
          },
        },
      };

      const def = getCloudModelDefinition("mygateway:jev", config);
      expect(def).toBeDefined();
      expect(def!.provider).toBe("mygateway");
      expect(def!.canonicalModel).toBe("jev");
      expect(def!.endpoint).toBe("https://gateway.internal/v1");
      expect(def!.driverType).toBe("jev");
    });
  });

  describe("setProviderInConfig & removeProviderFromConfig", () => {
    it("saves provider configuration in config.providers", () => {
      const initial: SailkariConfig = {};
      const updated = setProviderInConfig(initial, "zen", {
        apiKey: "zen-key",
        endpoint: "https://opencode-zen/v1",
        driverType: "jev",
        models: ["jev", "fast"],
      });

      expect(updated.providers?.zen).toEqual({
        apiKey: "zen-key",
        endpoint: "https://opencode-zen/v1",
        driverType: "jev",
        models: ["jev", "fast"],
      });
      expect(updated.apiKeys?.zen).toBe("zen-key");
    });

    it("adds and removes models from provider", () => {
      const initial: SailkariConfig = {
        providers: {
          zen: { apiKey: "key", models: ["m1"] },
        },
      };

      const added = addModelToProviderInConfig(initial, "zen", "m2");
      expect(added.providers?.zen?.models).toEqual(["m1", "m2"]);

      const removed = removeModelFromProviderInConfig(added, "zen", "m1");
      expect(removed.providers?.zen?.models).toEqual(["m2"]);
    });

    it("removes provider configuration from config", () => {
      const initial: SailkariConfig = {
        providers: {
          zen: { apiKey: "zen-key" },
        },
      };
      const { config: updated, removed } = removeProviderFromConfig(initial, "zen");
      expect(removed).toBe(true);
      expect(updated.providers?.zen).toBeUndefined();
    });
  });

  describe("normalizeProvider", () => {
    it("lowercases and trims providers", () => {
      expect(normalizeProvider(" TypeSafe ")).toBe("typesafe");
      expect(normalizeProvider("OpenAI")).toBe("openai");
      expect(normalizeProvider("ZEN")).toBe("zen");
    });
  });

  describe("maskApiKey", () => {
    it("masks short keys completely", () => {
      expect(maskApiKey("12345678")).toBe("********");
    });

    it("masks longer keys preserving start and end", () => {
      expect(maskApiKey("ts_live_secret_123456")).toBe("ts_l...3456");
    });
  });

  describe("resolveApiKey", () => {
    it("resolves from config if no env var is present", () => {
      const config: SailkariConfig = {
        providers: { typesafe: { apiKey: "ts_config_key_123" } },
      };
      const resolved = resolveApiKey("typesafe", config);
      expect(resolved).toEqual({ key: "ts_config_key_123", source: "config" });
    });

    it("prioritizes TYPESAFE_API_KEY over config", () => {
      process.env.TYPESAFE_API_KEY = "ts_env_key_456";
      const config: SailkariConfig = {
        providers: { typesafe: { apiKey: "ts_config_key_123" } },
      };
      const resolved = resolveApiKey("typesafe", config);
      expect(resolved).toEqual({ key: "ts_env_key_456", source: "env" });
    });

    it("returns undefined if no key is configured", () => {
      expect(resolveApiKey("typesafe", {})).toBeUndefined();
    });

    it("resolves OPENAI_API_KEY and GROQ_API_KEY from environment", () => {
      process.env.OPENAI_API_KEY = "sk-openai-key";
      process.env.GROQ_API_KEY = "gsk-groq-key";

      expect(resolveApiKey("openai")).toEqual({ key: "sk-openai-key", source: "env" });
      expect(resolveApiKey("groq")).toEqual({ key: "gsk-groq-key", source: "env" });
    });
  });

  describe("config mutations", () => {
    it("sets API key in config preserving existing keys", () => {
      const initial: SailkariConfig = {
        modelPath: "old.gguf",
        providers: { other: { apiKey: "val" } },
      };
      const updated = setApiKeyInConfig(initial, "typesafe", "ts_new_key");
      expect(updated.providers?.typesafe?.apiKey).toBe("ts_new_key");
      expect(updated.providers?.other?.apiKey).toBe("val");
      expect(updated.modelPath).toBe("old.gguf");
    });

    it("removes API key / provider from config", () => {
      const initial: SailkariConfig = {
        providers: { typesafe: { apiKey: "ts_key" }, other: { apiKey: "other_key" } },
      };
      const { config: updated, removed } = removeApiKeyFromConfig(initial, "typesafe");
      expect(removed).toBe(true);
      expect(updated.providers?.typesafe).toBeUndefined();
      expect(updated.providers?.other?.apiKey).toBe("other_key");
    });

    it("handles removing non-existent provider gracefully", () => {
      const initial: SailkariConfig = { providers: { other: { apiKey: "key" } } };
      const { config, removed } = removeApiKeyFromConfig(initial, "typesafe");
      expect(removed).toBe(false);
      expect(config).toBe(initial);
    });
  });

  describe("cloud models listing and status", () => {
    it("identifies cloud models correctly using provider:model format", () => {
      expect(isCloudModel("typesafe:jev")).toBe(true);
      expect(isCloudModel("typesafe:jev-latest")).toBe(true);
      expect(isCloudModel("openai:gpt-4o-mini")).toBe(true);
      expect(isCloudModel("groq:llama-3.3-70b-versatile")).toBe(true);
      expect(isCloudModel("openrouter:anthropic/claude-3.5-sonnet")).toBe(true);
      expect(isCloudModel("zen:jev")).toBe(true);
      expect(isCloudModel("/path/to/model.gguf")).toBe(false);
      expect(isCloudModel("model.gguf")).toBe(false);
      expect(isCloudModel("C:\\Users\\Francisco\\models\\Ministral-3-3B.gguf")).toBe(false);
      expect(isCloudModel("c:\\models\\model.gguf")).toBe(false);
      expect(isCloudModel("D:/models/model.gguf")).toBe(false);
      expect(isCloudModel("relative/path/model.gguf")).toBe(false);
    });

    it("parses dynamic cloud model definition for any provider", () => {
      expect(getCloudModelDefinition("C:\\Users\\Francisco\\models\\Ministral.gguf")).toBeUndefined();
      const def = getCloudModelDefinition("openai:custom-model");
      expect(def).toBeDefined();
      expect(def!.provider).toBe("openai");
      expect(def!.canonicalModel).toBe("custom-model");
      expect(def!.driverType).toBe("openai-compatible");
    });

    it("lists cloud models dynamically from configured provider models", () => {
      process.env.TYPESAFE_API_KEY = "ts_available_key";
      process.env.TYPESAFE_MODELS = "jev,jev-fast";

      const models = listCloudModels({});
      expect(models.length).toBe(2);
      expect(models.map((m) => m.id)).toEqual(["typesafe:jev", "typesafe:jev-fast"]);
      expect(models[0]?.available).toBe(true);
    });

    it("reports providers status with masked keys and associated models", () => {
      process.env.TYPESAFE_API_KEY = "ts_very_secret_api_key_12345";
      process.env.TYPESAFE_MODELS = "jev";

      const status = getApiKeysStatus({});
      const typesafeStatus = status.find((s) => s.provider === "typesafe");
      expect(typesafeStatus).toBeDefined();
      expect(typesafeStatus!.configured).toBe(true);
      expect(typesafeStatus!.source).toBe("env");
      expect(typesafeStatus!.maskedKey).toBe("ts_v...2345");
      expect(typesafeStatus!.rawKey).toBe("ts_very_secret_api_key_12345");
      expect(typesafeStatus!.models).toEqual(["jev"]);
    });
  });
});
