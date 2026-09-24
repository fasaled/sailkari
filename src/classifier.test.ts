import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, mock } from "bun:test";
import { ClassificationStore } from "./classification-store.js";
import { processFile } from "./classifier.js";
import type { LLMEngine } from "./llm-engine.js";

describe("processFile", () => {
  test("returns stored labels when an existing classification is skipped", async () => {
    const folder = await mkdtemp(join(tmpdir(), "sailkari-classifier-"));
    const filePath = join(folder, "statement.txt");
    const store = new ClassificationStore(folder);
    store.setLabels(filePath, ["banking"]);

    try {
      const result = await processFile(filePath, [], false, {} as LLMEngine, store);
      expect(result).toMatchObject({ status: "skip", labels: ["banking"], reason: "already classified" });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  test("classifies a file again when its stored entry has no labels", async () => {
    const folder = await mkdtemp(join(tmpdir(), "sailkari-classifier-"));
    const filePath = join(folder, "new-document.txt");
    const store = new ClassificationStore(folder);
    store.setLabels(filePath, []);
    await writeFile(filePath, "Account statement");
    const engine = { classify: mock(async () => ({ labels: ["banking"] })) } as unknown as LLMEngine;

    try {
      const result = await processFile(filePath, [{ name: "banking", description: "financial document" }], false, engine, store);
      expect(engine.classify).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: "ok", labels: ["banking"], calls: 1, chunks: 1 });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  test("includes calls and chunks when result has no matching labels", async () => {
    const folder = await mkdtemp(join(tmpdir(), "sailkari-classifier-"));
    const filePath = join(folder, "unmatched.txt");
    const store = new ClassificationStore(folder);
    await writeFile(filePath, "Random notes");
    const engine = { classify: mock(async () => ({ labels: [] })) } as unknown as LLMEngine;

    try {
      const result = await processFile(filePath, [{ name: "banking", description: "financial document" }], false, engine, store);
      expect(engine.classify).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: "none", calls: 1, chunks: 1 });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});