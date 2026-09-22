import { test, expect, describe, afterEach, beforeEach } from "bun:test";
import { watchFolder } from "./watcher.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("watcher duplicate handling", () => {
  let testDir: string;
  let ac: AbortController;
  let watcher: Awaited<ReturnType<typeof watchFolder>> | null = null;

  beforeEach(async () => {
    testDir = join(tmpdir(), `watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    ac = new AbortController();
  });

  afterEach(async () => {
    if (watcher) {
      ac.abort();
      try { watcher.close(); } catch {}
      watcher = null;
    }
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  async function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  test("same file written multiple times in quick succession is processed once", async () => {
    const events: string[] = [];
    watcher = await watchFolder({
      folder: testDir,
      debounceMs: 100,
      cooldownMs: 5000,
      signal: ac.signal,
      onFile: async (filePath) => {
        events.push(filePath);
        await wait(50);
      },
    });

    const filePath = join(testDir, "file.txt");
    await writeFile(filePath, "v1");
    await wait(50);
    await writeFile(filePath, "v2");
    await wait(50);
    await writeFile(filePath, "v3");
    await wait(300);

    expect(events.length).toBe(1);
  });

  test("different files are processed in order", async () => {
    const events: string[] = [];
    watcher = await watchFolder({
      folder: testDir,
      debounceMs: 100,
      cooldownMs: 5000,
      signal: ac.signal,
      onFile: async (filePath) => {
        events.push(filePath.split("/").pop() || filePath);
        await wait(150);
      },
    });

    await writeFile(join(testDir, "a.txt"), "a");
    await wait(200);
    await writeFile(join(testDir, "b.txt"), "b");
    await wait(200);
    await writeFile(join(testDir, "c.txt"), "c");
    await wait(500);

    expect(events).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  test("cooldown prevents reprocessing of same file", async () => {
    const events: string[] = [];
    watcher = await watchFolder({
      folder: testDir,
      debounceMs: 50,
      cooldownMs: 1000,
      signal: ac.signal,
      onFile: async (filePath) => {
        events.push(filePath);
      },
    });

    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "v1");
    await wait(200);
    await writeFile(filePath, "v2");
    await wait(200);

    expect(events.length).toBe(1);
  });

  test("processing is serialized across multiple files", async () => {
    const events: { file: string; t: number }[] = [];
    const start = Date.now();
    watcher = await watchFolder({
      folder: testDir,
      debounceMs: 100,
      cooldownMs: 5000,
      signal: ac.signal,
      onFile: async (filePath) => {
        const file = filePath.split("/").pop() || filePath;
        await wait(200);
        events.push({ file, t: Date.now() - start });
      },
    });

    await writeFile(join(testDir, "a.txt"), "a");
    await wait(50);
    await writeFile(join(testDir, "b.txt"), "b");
    await wait(50);
    await writeFile(join(testDir, "c.txt"), "c");
    await wait(800);

    expect(events.length).toBe(3);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.t).toBeGreaterThanOrEqual(events[i - 1]!.t);
    }
  });
});
