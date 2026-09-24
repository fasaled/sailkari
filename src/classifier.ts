import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { EngineContext, LLMEngine } from "./llm-engine.js";
import type { Label, ProcessingResult, LabelsFile } from "./types.js";
import { extractFileInfo } from "./metadata.js";
import type { ClassificationStore } from "./classification-store.js";
import { determineStrategy } from "./context.js";
import type { ProgressCallback } from "./llm-engine.js";

export async function processFile(
  filePath: string,
  labels: Label[],
  force: boolean,
  engine: LLMEngine,
  store: ClassificationStore,
  systemPrompt?: string,
  signal?: AbortSignal,
  onProgress?: ProgressCallback,
  context?: EngineContext,
  modelMetadata?: { model?: string; provider?: string }
): Promise<ProcessingResult> {
  const startedAt = performance.now();
  signal?.throwIfAborted();
  const hasAIClassified = store.has(filePath);
  const storedEntry = hasAIClassified ? store.getEntry(filePath) : undefined;
  const storedLabels = storedEntry?.labels ?? [];

  if (storedLabels.length > 0 && !force) {
    return {
      status: "skip",
      filePath,
      labels: storedLabels,
      reason: "already classified",
      durationMs: performance.now() - startedAt,
      model: storedEntry?.model,
      provider: storedEntry?.provider,
    };
  }

  const filename = filePath.split("/").pop() || filePath;
  const fileInfo = extractFileInfo(filePath, store);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return {
      status: "skip",
      filePath,
      reason: "cannot read file",
      durationMs: performance.now() - startedAt,
    };
  }

  const reportProgress = onProgress ?? (() => {});

  const { result, chunks, calls, inferenceMs } = await determineStrategy(
    content,
    {
      filename: fileInfo.name,
      extension: fileInfo.extension,
      size: fileInfo.size,
      created: fileInfo.created,
      modified: fileInfo.modified,
      existingTags: fileInfo.existingTags,
    },
    labels,
    engine,
    reportProgress,
    systemPrompt,
    signal,
    context
  );

  if (!result || result.labels.length === 0) {
    if (force && hasAIClassified) {
      store.setLabels(filePath, [], modelMetadata);
    }
    return {
      status: "none",
      filePath,
      chunks,
      calls,
      durationMs: performance.now() - startedAt,
      inferenceMs,
      sourceBytes: fileInfo.size,
      inputTokensEstimate: Math.ceil(content.length / 4),
      model: modelMetadata?.model,
      provider: modelMetadata?.provider,
    };
  }

  if (force && hasAIClassified) {
    store.remove(filePath);
  }

  store.setLabels(filePath, result.labels, modelMetadata);

  return {
    status: "ok",
    filePath,
    labels: result.labels,
    chunks,
    calls,
    durationMs: performance.now() - startedAt,
    inferenceMs,
    sourceBytes: fileInfo.size,
    inputTokensEstimate: Math.ceil(content.length / 4),
    model: modelMetadata?.model,
    provider: modelMetadata?.provider,
  };
}

export async function loadLabels(labelsPath: string): Promise<Label[]> {
  const content = await readFile(labelsPath, "utf8");
  const parsed = parse(content) as LabelsFile;
  const labels: Label[] = [];
  for (const [name, description] of Object.entries(parsed)) {
    if (typeof description === "string") {
      labels.push({ name, description });
    }
  }
  if (labels.length === 0) {
    throw new Error(`No labels found in ${labelsPath}. Make sure it's a YAML file with label definitions.`);
  }
  return labels;
}
