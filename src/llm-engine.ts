import {
  getLlama,
  LlamaChatSession,
  LlamaLogLevel,
  type Llama,
  type LlamaContext,
  type LlamaContextSequence,
  type LlamaModel,
} from "node-llama-cpp";
import type { ClassificationResult, Label } from "./types.js";
import { parseResponse, selectLabelByMajority } from "./parser.js";
import { DEFAULT_SYSTEM_PROMPT, buildUserPayload } from "./prompt.js";

const MAX_CONTEXT = 32768;
const SYSTEM_RESERVE = 1024;
export const EFFECTIVE_LIMIT = MAX_CONTEXT - SYSTEM_RESERVE;

export type ProgressCallback = (current: number, total: number, message: string) => void;
export type NativeLogCallback = (level: LlamaLogLevel, message: string) => void;

const noopProgress: ProgressCallback = () => {};

export interface GenerationOptions {
  systemPrompt: string;
  prompt: string;
  maxTokens?: number;
  onToken?: (text: string) => void;
  signal?: AbortSignal;
}

export interface EngineContext {
  generate(options: GenerationOptions): Promise<string>;
  clearHistory(): Promise<void>;
  dispose(): Promise<void>;
}

export interface EngineModel {
  createContext(): Promise<EngineContext>;
  dispose(): Promise<void>;
}

export interface EngineDriver {
  loadModel(modelPath: string): Promise<EngineModel>;
  dispose(): Promise<void>;
}

class NodeLlamaContext implements EngineContext {
  private readonly sequence: LlamaContextSequence;

  constructor(private readonly context: LlamaContext) {
    this.sequence = context.getSequence();
  }

  async generate(options: GenerationOptions): Promise<string> {
    const session = new LlamaChatSession({
      contextSequence: this.sequence,
      systemPrompt: options.systemPrompt,
      autoDisposeSequence: false,
    });

    try {
      return await session.prompt(options.prompt, {
        maxTokens: options.maxTokens ?? 64,
        temperature: 0,
        onTextChunk: options.onToken,
        signal: options.signal,
      });
    } finally {
      session.dispose();
    }
  }

  async dispose(): Promise<void> {
    try {
      await this.sequence.dispose();
    } finally {
      await this.context.dispose();
    }
  }

  async clearHistory(): Promise<void> {
    await this.sequence.clearHistory();
  }
}

class NodeLlamaModel implements EngineModel {
  constructor(private readonly model: LlamaModel) {}

  async createContext(): Promise<EngineContext> {
    const context = await this.model.createContext({
      contextSize: MAX_CONTEXT,
    });
    return new NodeLlamaContext(context);
  }

  async dispose(): Promise<void> {
    await this.model.dispose();
  }
}

class NodeLlamaDriver implements EngineDriver {
  private llama: Llama | null = null;

  constructor(private readonly logger?: NativeLogCallback) {}

  async loadModel(modelPath: string): Promise<EngineModel> {
    this.llama ??= await getLlama({
      build: "never",
      usePrebuiltBinaries: true,
      logLevel: LlamaLogLevel.warn,
      logger: this.logger,
    });
    const model = await this.llama.loadModel({ modelPath });
    return new NodeLlamaModel(model);
  }

  async dispose(): Promise<void> {
    if (this.llama) {
      await this.llama.dispose();
      this.llama = null;
    }
  }
}

export function createLLMEngine(logger: NativeLogCallback): LLMEngine {
  return new LLMEngine(new NodeLlamaDriver(logger));
}

export class LLMEngine {
  private model: EngineModel | null = null;
  private disposed = false;

  constructor(private readonly driver: EngineDriver = new NodeLlamaDriver()) {}

  async loadModel(modelPath: string): Promise<void> {
    if (this.disposed) {
      throw new Error("The engine has been disposed.");
    }
    if (this.model) {
      throw new Error("A model is already loaded. Dispose the engine before loading another model.");
    }
    this.model = await this.driver.loadModel(modelPath);
  }

  async createContext(): Promise<EngineContext> {
    if (!this.model) {
      throw new Error("No model is loaded. Call loadModel() first.");
    }
    return this.model.createContext();
  }

  async generate(options: GenerationOptions): Promise<string> {
    const context = await this.createContext();
    try {
      return await context.generate(options);
    } finally {
      await context.dispose();
    }
  }

  async classify(
    content: string,
    labels: Label[],
    onProgress: ProgressCallback = noopProgress,
    systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
    signal?: AbortSignal,
    context?: EngineContext
  ): Promise<ClassificationResult | null> {
    signal?.throwIfAborted();
    onProgress(0, 1, "classifying");
    const options = {
      systemPrompt,
      prompt: buildUserPayload(labels, content),
      signal,
    };
    const text = context ? await context.generate(options) : await this.generate(options);
    onProgress(1, 1, "done");

    const result = parseResponse(text, labels);
    return result?.labels.length ? { labels: result.labels.slice(0, 1) } : null;
  }

  async classifyChunked(
    content: string,
    labels: Label[],
    onProgress: ProgressCallback = noopProgress,
    systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
    signal?: AbortSignal,
    context?: EngineContext
  ): Promise<{ result: ClassificationResult | null; chunks: number; calls: number }> {
    const chunkSize = EFFECTIVE_LIMIT - 2000;
    const chunks: string[] = [];
    let start = 0;

    while (start < content.length) {
      let end = start + chunkSize;
      if (end < content.length) {
        const spaceIndex = content.lastIndexOf(" ", end);
        if (spaceIndex > start + chunkSize / 2) {
          end = spaceIndex;
        }
      }
      chunks.push(content.slice(start, end));
      start = end;
    }

    const labelCounts: Record<string, number> = {};
    let calls = 0;
    for (let i = 0; i < chunks.length; i++) {
      signal?.throwIfAborted();
      if (i > 0) await context?.clearHistory();
      onProgress(i, chunks.length, `chunk ${i + 1}/${chunks.length}`);
      const chunk = chunks[i]!;
      const options = {
        systemPrompt,
        prompt: buildUserPayload(labels, chunk),
        signal,
      };
      const text = context ? await context.generate(options) : await this.generate(options);
      calls++;

      const parsed = parseResponse(text, labels);
      if (parsed?.labels.length) {
        const label = parsed.labels[0]!;
        labelCounts[label] = (labelCounts[label] ?? 0) + 1;
      }
    }

    onProgress(chunks.length, chunks.length, "finalizing");
    const winner = selectLabelByMajority(labelCounts);
    return {
      result: winner ? { labels: [winner] } : null,
      chunks: chunks.length,
      calls,
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    const model = this.model;
    this.model = null;

    try {
      await model?.dispose();
    } finally {
      await this.driver.dispose();
    }
  }
}
