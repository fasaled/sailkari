import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { access, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadLabels, processFile } from "../src/classifier.js";
import { ClassificationStore } from "../src/classification-store.js";
import { LLMEngine } from "../src/llm-engine.js";

/**
 * Real in-process llama.cpp inference. Skipped when a GGUF is missing
 * (CI, fresh clone). Does not write RESULTS.md or any other report file.
 *
 *   npm run test:e2e
 *   CLASSIFIER_MODEL=models/your-model.gguf npm run test:e2e
 *   CLASSIFIER_E2E=0 npm test   # skip even if a model is present
 */

const FIXTURES: { file: string; label: string }[] = [
  { file: "bank-statement.txt", label: "banking" },
  { file: "vet-records.txt", label: "pets" },
  { file: "birthday-card.txt", label: "family" },
  { file: "microservices-architecture.txt", label: "technology" },
  { file: "sales-proposal.txt", label: "marketing" },
];

async function resolveModel(): Promise<string | null> {
  const fromEnv = process.env.CLASSIFIER_MODEL;
  if (fromEnv) {
    try {
      await access(fromEnv);
      return fromEnv;
    } catch {
      return null;
    }
  }

  try {
    const found = (await readdir("models"))
      .filter((file) => file.endsWith(".gguf"))
      .sort()
      .map((file) => join("models", file));
    return found[0] ?? null;
  } catch {
    return null;
  }
}

const modelPath = await resolveModel();
const enabled = process.env.CLASSIFIER_E2E !== "0" && modelPath !== null;

describe.skipIf(!enabled)("e2e inference", () => {
  let workDir: string;
  let labels: Awaited<ReturnType<typeof loadLabels>>;
  let engine: LLMEngine;
  let store: ClassificationStore;

  beforeAll(async () => {
    labels = await loadLabels("examples/labels.yaml");
    workDir = join(tmpdir(), `classifier-e2e-${Date.now()}`);
    await mkdir(workDir, { recursive: true });
    for (const { file } of FIXTURES) {
      const src = join("examples/documents", file);
      const dest = join(workDir, file);
      await copyFile(src, dest);
    }
    store = new ClassificationStore(workDir);
    engine = new LLMEngine();
    await engine.loadModel(modelPath!);
  }, 240_000);

  afterAll(async () => {
    await engine?.dispose();
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  for (const { file, label } of FIXTURES) {
    test(
      `${file} → ${label}`,
      async () => {
        const path = join(workDir, file);
        store.remove(path);
        const result = await processFile(path, labels, true, engine, store);
        expect(result.status).toBe("ok");
        expect(result.labels).toEqual([label]);
        expect(store.has(path)).toBe(true);
        expect(store.getLabels(path)).toEqual([label]);
      },
      120_000
    );
  }

  test("skips a file that already has the marker", async () => {
    const path = join(workDir, "bank-statement.txt");
    expect(store.has(path)).toBe(true);
    const result = await processFile(path, labels, false, engine, store);
    expect(result.status).toBe("skip");
  });

  test("--force reclassifies and keeps a valid label", async () => {
    const path = join(workDir, "bank-statement.txt");
    const result = await processFile(path, labels, true, engine, store);
    expect(result.status).toBe("ok");
    expect(result.labels).toEqual(["banking"]);
  }, 120_000);
});
