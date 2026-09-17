import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
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
    const engine = { classify: vi.fn(async () => ({ labels: ["banking"] })) } as unknown as LLMEngine;

    try {
      const result = await processFile(filePath, [{ name: "banking", description: "financial document" }], false, engine, store);
      expect(engine.classify).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ status: "ok", labels: ["banking"] });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});