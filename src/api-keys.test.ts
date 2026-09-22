import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getApiKeysStatus,
  getCloudModelDefinition,
  isCloudModel,
  listCloudModels,
  maskApiKey,
  normalizeProvider,
  removeApiKeyFromConfig,
  resolveApiKey,
  setApiKeyInConfig,
} from "./api-keys.js";
import type { SailkariConfig } from "./config.js";

describe("api-keys", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.JEV_API_KEY;
    delete process.env.SAILKARI_KEY_TYPESAFE;
    delete process.env.SAILKARI_API_KEYS;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.SAILKARI_KEY_OPENAI;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("normalizeProvider", () => {
    it("normalizes 'jev' to 'typesafe'", () => {
      expect(normalizeProvider("jev")).toBe("typesafe");
      expect(normalizeProvider("JEV")).toBe("typesafe");
    });

    it("lowercases and trims other providers", () => {
      expect(normalizeProvider(" TypeSafe ")).toBe("typesafe");
      expect(normalizeProvider("OpenAI")).toBe("openai");
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
        apiKeys: { typesafe: "ts_config_key_123" },
      };
      const resolved = resolveApiKey("typesafe", config);
      expect(resolved).toEqual({ key: "ts_config_key_123", source: "config" });
    });

    it("resolves alias 'jev' from config typesafe key", () => {
      const config: SailkariConfig = {
        apiKeys: { typesafe: "ts_config_key_123" },
      };
      const resolved = resolveApiKey("jev", config);
      expect(resolved).toEqual({ key: "ts_config_key_123", source: "config" });
    });

    it("prioritizes TYPESAFE_API_KEY over config", () => {
      process.env.TYPESAFE_API_KEY = "ts_env_key_456";
      const config: SailkariConfig = {
        apiKeys: { typesafe: "ts_config_key_123" },
      };
      const resolved = resolveApiKey("typesafe", config);
      expect(resolved).toEqual({ key: "ts_env_key_456", source: "env" });
    });

    it("resolves from JEV_API_KEY env var", () => {
      process.env.JEV_API_KEY = "ts_jev_env_789";
      const resolved = resolveApiKey("typesafe");
      expect(resolved).toEqual({ key: "ts_jev_env_789", source: "env" });
    });

    it("resolves from SAILKARI_KEY_<PROVIDER> env var", () => {
      process.env.SAILKARI_KEY_TYPESAFE = "ts_prefixed_env";
      const resolved = resolveApiKey("typesafe");
      expect(resolved).toEqual({ key: "ts_prefixed_env", source: "env" });
    });

    it("resolves from SAILKARI_API_KEYS json env var", () => {
      process.env.SAILKARI_API_KEYS = JSON.stringify({ typesafe: "ts_json_key" });
      const resolved = resolveApiKey("typesafe");
      expect(resolved).toEqual({ key: "ts_json_key", source: "env" });
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
        apiKeys: { other: "val" },
      };
      const updated = setApiKeyInConfig(initial, "typesafe", "ts_new_key");
      expect(updated.apiKeys).toEqual({
        other: "val",
        typesafe: "ts_new_key",
      });
      expect(updated.modelPath).toBe("old.gguf");
    });

    it("removes API key from config", () => {
      const initial: SailkariConfig = {
        apiKeys: { typesafe: "ts_key", other: "other_key" },
      };
      const { config: updated, removed } = removeApiKeyFromConfig(initial, "typesafe");
      expect(removed).toBe(true);
      expect(updated.apiKeys).toEqual({ other: "other_key" });
    });

    it("handles removing non-existent API key gracefully", () => {
      const initial: SailkariConfig = { apiKeys: { other: "key" } };
      const { config, removed } = removeApiKeyFromConfig(initial, "typesafe");
      expect(removed).toBe(false);
      expect(config).toBe(initial);
    });
  });

  describe("cloud models listing and status", () => {
    it("identifies cloud models correctly", () => {
      expect(isCloudModel("jev")).toBe(true);
      expect(isCloudModel("typesafe:jev")).toBe(true);
      expect(isCloudModel("typesafe:jev-latest")).toBe(true);
      expect(isCloudModel("openai:gpt-4o-mini")).toBe(true);
      expect(isCloudModel("groq:llama-3.3-70b-versatile")).toBe(true);
      expect(isCloudModel("openrouter:anthropic/claude-3.5-sonnet")).toBe(true);
      expect(isCloudModel("/path/to/model.gguf")).toBe(false);
    });

    it("parses dynamic cloud model definition for OpenAI-compatible providers", () => {
      const def = getCloudModelDefinition("openai:custom-model");
      expect(def).toBeDefined();
      expect(def!.provider).toBe("openai");
      expect(def!.canonicalModel).toBe("custom-model");
      expect(def!.driverType).toBe("openai-compatible");
    });

    it("lists cloud models with availability status based on resolved key", () => {
      process.env.TYPESAFE_API_KEY = "ts_available_key";
      const models = listCloudModels({});
      const jev = models.find((m) => m.id === "jev");
      expect(jev).toBeDefined();
      expect(jev!.available).toBe(true);
      expect(jev!.source).toBe("env");
    });

    it("reports keys status with masked values", () => {
      process.env.TYPESAFE_API_KEY = "ts_very_secret_api_key_12345";
      const status = getApiKeysStatus({});
      const typesafeStatus = status.find((s) => s.provider === "typesafe");
      expect(typesafeStatus).toBeDefined();
      expect(typesafeStatus!.configured).toBe(true);
      expect(typesafeStatus!.source).toBe("env");
      expect(typesafeStatus!.maskedKey).toBe("ts_v...2345");
      expect(typesafeStatus!.rawKey).toBe("ts_very_secret_api_key_12345");
    });
  });
});
