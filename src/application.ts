import { basename, resolve } from "node:path";
import { ClassificationStore } from "./classification-store.js";
import { loadLabels, processFile } from "./classifier.js";
import { scanFolder } from "./file-scanner.js";
import { createLLMEngine, type EngineContext, type LLMEngine, type NativeLogCallback } from "./llm-engine.js";
import { DEFAULT_SYSTEM_PROMPT, inspectSystemPrompt, loadSystemPrompt } from "./prompt.js";
import { summarizeEvaluation } from "./evaluation-metrics.js";
import type { ProcessingResult } from "./types.js";

export interface EvaluationOptions {
  folder: string;
  labels: string;
  force: boolean;
  contextReuse: "none" | "file" | "command";
  signal?: AbortSignal;
  onProgress?: (filePath: string, current: number, total: number, message: string) => void;
  onResult?: (result: ProcessingResult) => void;
  onStart?: (folder: string, fileCount: number) => void;
}

export interface EvaluationResult {
  folder: string;
  results: ProcessingResult[];
  summary: ReturnType<typeof summarizeEvaluation>;
}

export class SailkariApplication {
  private engine: LLMEngine;
  private modelPath: string | undefined;
  private systemPrompt = DEFAULT_SYSTEM_PROMPT;

  constructor(private readonly nativeLogger?: NativeLogCallback) {
    this.engine = createLLMEngine(nativeLogger ?? (() => {}));
  }

  get loadedModelPath(): string | undefined {
    return this.modelPath;
  }

  get configuredSystemPrompt(): string {
    return this.systemPrompt;
  }

  async loadModel(modelPath: string): Promise<string> {
    const absolutePath = resolve(modelPath);
    await this.engine.dispose();
    this.engine = createLLMEngine(this.nativeLogger ?? (() => {}));
    await this.engine.loadModel(absolutePath);
    this.modelPath = absolutePath;
    return absolutePath;
  }

  async setSystemPrompt(prompt: string): Promise<{ warnings: string[] }> {
    this.systemPrompt = prompt.trim();
    return { warnings: inspectSystemPrompt(this.systemPrompt) };
  }

  async loadSystemPrompt(path: string | null): Promise<{ path: string | null; prompt: string; warnings: string[] }> {
    if (path === null) {
      this.systemPrompt = DEFAULT_SYSTEM_PROMPT;
      return { path: null, prompt: this.systemPrompt, warnings: [] };
    }
    const absolutePath = resolve(path);
    const prompt = await loadSystemPrompt(absolutePath);
    this.systemPrompt = prompt;
    return { path: absolutePath, prompt, warnings: inspectSystemPrompt(prompt) };
  }

  async evaluate(options: EvaluationOptions): Promise<EvaluationResult> {
    const startedAt = performance.now();
    const labels = await loadLabels(resolve(options.labels));
    const folder = resolve(options.folder);
    const files = scanFolder(folder);
    const preparationMs = performance.now() - startedAt;
    options.onStart?.(folder, files.length);
    const store = new ClassificationStore(folder);
    const results: ProcessingResult[] = [];
    const commandContext = options.contextReuse === "command" ? await this.engine.createContext() : undefined;

    try {
      for (const filePath of files) {
        options.signal?.throwIfAborted();
        if (commandContext && results.length > 0) await commandContext.clearHistory();
        const fileContext: EngineContext | undefined = options.contextReuse === "file"
          ? await this.engine.createContext()
          : commandContext;
        try {
          const result = await processFile(
            filePath,
            labels,
            options.force,
            this.engine,
            store,
            this.systemPrompt,
            options.signal,
            options.onProgress ? (current, total, message) => options.onProgress!(filePath, current, total, message) : undefined,
            fileContext,
          );
          results.push(result);
          options.onResult?.(result);
        } finally {
          if (options.contextReuse === "file") await fileContext?.dispose();
        }
      }
    } finally {
      await commandContext?.dispose();
    }

    return {
      folder,
      results,
      summary: summarizeEvaluation(results, performance.now() - startedAt, preparationMs),
    };
  }

  listClassifications(folderPath: string): { filePath: string; labels: string[] }[] {
    return new ClassificationStore(resolve(folderPath)).entries();
  }

  removeClassifications(folderPath: string): { filePath: string; labels: string[] }[] {
    const store = new ClassificationStore(resolve(folderPath));
    const entries = store.entries();
    for (const entry of entries) store.remove(entry.filePath);
    return entries;
  }

  async dispose(): Promise<void> {
    await this.engine.dispose();
  }

  static fileName(filePath: string): string {
    return basename(filePath);
  }
}
