import type { EngineContext, LLMEngine, ProgressCallback } from "./llm-engine.js";
import { EFFECTIVE_LIMIT } from "./llm-engine.js";
import type { Label, ClassificationResult } from "./types.js";

export interface ContextStrategyResult {
  result: ClassificationResult | null;
  chunks?: number;
  calls?: number;
  inferenceMs: number;
}

export async function determineStrategy(
  content: string,
  metadata: {
    filename: string;
    extension: string;
    size: number;
    created: Date;
    modified: Date;
    existingTags: string[];
  },
  labels: Label[],
  engine: LLMEngine,
  onProgress?: ProgressCallback,
  systemPrompt?: string,
  signal?: AbortSignal,
  context?: EngineContext
): Promise<ContextStrategyResult> {
  const tokenCount = Math.ceil(content.length / 4);
  const startedAt = performance.now();

  if (tokenCount <= EFFECTIVE_LIMIT) {
    const result = await engine.classify(content, labels, onProgress, systemPrompt, signal, context);
    return { result, chunks: 1, calls: 1, inferenceMs: performance.now() - startedAt };
  }

  const { result, chunks, calls } = await engine.classifyChunked(
    content,
    labels,
    onProgress,
    systemPrompt,
    signal,
    context
  );
  return { result, chunks, calls, inferenceMs: performance.now() - startedAt };
}