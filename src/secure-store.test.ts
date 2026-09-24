import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  type CredentialStoreBackend,
  SecureCredentialStore,
  StrictFileBackend,
} from "./secure-store.js";
import { resolveApiKeyAsync } from "./api-keys.js";
import { saveConfig } from "./config.js";

describe("StrictFileBackend (0600 file store)", () => {
  it("stores, retrieves and deletes credentials with strict permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sailkari-sec-"));
    const storePath = join(dir, "credentials.json");

    try {
      const backend = new StrictFileBackend(storePath);
      expect(await backend.get("openai")).toBeUndefined();

      await backend.set("openai", "sk-test-key-123");
      expect(await backend.get("openai")).toBe("sk-test-key-123");

      const s = await stat(storePath);
      // In POSIX systems, ensure permissions are 0600 (read/write for owner only)
      if (process.platform !== "win32") {
        expect(s.mode & 0o777).toBe(0o600);
      }

      const raw = JSON.parse(await readFile(storePath, "utf8"));
      expect(raw.openai).toBe("sk-test-key-123");

      const deleted = await backend.delete("openai");
      expect(deleted).toBe(true);
      expect(await backend.get("openai")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SecureCredentialStore (composite)", () => {
  it("prefers primary backend if available", async () => {
    const memory = new Map<string, string>([["typesafe", "ts-key-primary"]]);
    const mockPrimary: CredentialStoreBackend = {
      async get(p: string) { return memory.get(p); },
      async set(p: string, s: string) { memory.set(p, s); },
      async delete(p: string) { return memory.delete(p); },
    };

    const dir = await mkdtemp(join(tmpdir(), "sailkari-sec-"));
    const fallbackPath = join(dir, "credentials.json");

    try {
      const fallback = new StrictFileBackend(fallbackPath);
      await fallback.set("typesafe", "ts-key-fallback");

      const store = new SecureCredentialStore({
        primary: mockPrimary,
        fallback,
      });

      // Returns primary
      expect(await store.get("typesafe")).toBe("ts-key-primary");

      // Writes to primary and cleans up fallback
      await store.set("groq", "gsk-key");
      expect(await mockPrimary.get("groq")).toBe("gsk-key");
      expect(await fallback.get("groq")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("transparently falls back to file backend if primary fails or returns empty", async () => {
    const failingPrimary: CredentialStoreBackend = {
      async get() { throw new Error("Keychain locked"); },
      async set() { throw new Error("Keychain locked"); },
      async delete() { throw new Error("Keychain locked"); },
    };

    const dir = await mkdtemp(join(tmpdir(), "sailkari-sec-"));
    const fallbackPath = join(dir, "credentials.json");

    try {
      const fallback = new StrictFileBackend(fallbackPath);
      const store = new SecureCredentialStore({
        primary: failingPrimary,
        fallback,
      });

      await store.set("openai", "sk-fallback-stored");
      expect(await store.get("openai")).toBe("sk-fallback-stored");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveApiKeyAsync with SecureCredentialStore", () => {
  it("resolves from environment variable before secure store", async () => {
    process.env.TYPESAFE_API_KEY = "env-typesafe-key";
    const mockStore = new SecureCredentialStore({
      primary: null,
      fallback: {
        async get() { return "keychain-key"; },
        async set() {},
        async delete() { return true; },
      },
    });

    const resolved = await resolveApiKeyAsync("typesafe", {}, mockStore);
    expect(resolved).toEqual({ key: "env-typesafe-key", source: "env" });
    delete process.env.TYPESAFE_API_KEY;
  });

  it("resolves from secure store when env var is absent", async () => {
    delete process.env.GROQ_API_KEY;
    const mockStore = new SecureCredentialStore({
      primary: null,
      fallback: {
        async get(p: string) { return p === "groq" ? "gsk-secure-key" : undefined; },
        async set() {},
        async delete() { return true; },
      },
    });

    const resolved = await resolveApiKeyAsync("groq", {}, mockStore);
    expect(resolved).toEqual({ key: "gsk-secure-key", source: "keychain" });
  });
});

describe("saveConfig auto-sync to secureStore", () => {
  it("syncs config providers to secure storage and sets 0600 on config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sailkari-cfg-"));
    const cfgPath = join(dir, "config.json");
    const dataMap = new Map<string, string>();
    const mockBackend: CredentialStoreBackend = {
      async get(p) { return dataMap.get(p); },
      async set(p, s) { dataMap.set(p, s); },
      async delete(p) { return dataMap.delete(p); },
    };
    const secureStore = new SecureCredentialStore({ primary: null, fallback: mockBackend });

    try {
      await saveConfig(
        {
          providers: {
            openai: { apiKey: "sk-sync-test", endpoint: "https://api.openai.com/v1" },
          },
        },
        cfgPath,
        secureStore
      );

      // Verify synced into secureStore
      expect(await secureStore.get("openai")).toBe("sk-sync-test");

      // Verify file permissions
      const s = await stat(cfgPath);
      if (process.platform !== "win32") {
        expect(s.mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("migrates existing legacy keys when loadConfig reads an existing configuration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sailkari-cfg-legacy-"));
    const cfgPath = join(dir, "config.json");
    await writeFile(
      cfgPath,
      JSON.stringify({
        providers: {
          typesafe: { apiKey: "ts-legacy-key" },
        },
      }),
      "utf8"
    );

    const dataMap = new Map<string, string>();
    const mockBackend: CredentialStoreBackend = {
      async get(p) { return dataMap.get(p); },
      async set(p, s) { dataMap.set(p, s); },
      async delete(p) { return dataMap.delete(p); },
    };
    const secureStore = new SecureCredentialStore({ primary: null, fallback: mockBackend });

    try {
      const { loadConfig } = await import("./config.js");
      const loaded = await loadConfig(cfgPath, secureStore);
      expect(loaded.providers?.typesafe?.apiKey).toBe("ts-legacy-key");

      // Give event loop tick for async auto-migration
      await new Promise((r) => setTimeout(r, 10));
      expect(await secureStore.get("typesafe")).toBe("ts-legacy-key");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
