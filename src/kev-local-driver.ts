import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  getLlama,
  LlamaLogLevel,
  type Llama,
  type LlamaContext,
  type LlamaContextSequence,
  type LlamaModel,
} from "node-llama-cpp";
import type { ClassificationResult, Label } from "./types.js";
import type { EngineContext, EngineDriver, EngineModel, GenerationOptions, NativeLogCallback } from "./llm-engine.js";

const MAX_CONTEXT = 8192;
const MAX_STATE_TOKENS = 8192;

export interface KevHeadData {
  format: number;
  base: string;
  base_revision?: string;
  run?: string;
  hidden_size: number;
  head_dim: number;
  temperature: number;
  q_weight: number[][];
  q_bias: number[];
  k_weight: number[][];
  k_bias: number[];
}

export interface KevManifestData {
  format?: number;
  run?: string;
  base?: string;
  temperature?: number;
  hidden_size?: number;
  head_dim?: number;
  model?: string;
  head?: string;
  files?: Record<string, { sha256: string; size: number }>;
}

export interface KevBundlePaths {
  modelPath: string;
  headPath: string;
  manifestPath?: string;
}

export async function detectKevBundle(targetPath: string): Promise<KevBundlePaths | null> {
  try {
    const s = await stat(targetPath);
    let dir: string;
    let modelFile: string | undefined;

    if (s.isDirectory()) {
      dir = targetPath;
      const manifestFile = join(dir, "manifest.json");
      const headFile = join(dir, "head.json");

      let hasHead = false;
      try {
        await stat(headFile);
        hasHead = true;
      } catch {
        // Not a Kev directory without head.json
      }
      if (!hasHead) return null;

      try {
        const manifestRaw = await readFile(manifestFile, "utf8");
        const manifest = JSON.parse(manifestRaw) as KevManifestData;
        if (manifest.model) {
          modelFile = join(dir, manifest.model);
        }
      } catch {
        // Fall back to scanning model-*.gguf or model.gguf
      }

      if (!modelFile) {
        for (const candidate of ["model-f16.gguf", "model-q8_0.gguf", "model-bf16.gguf", "model.gguf"]) {
          try {
            await stat(join(dir, candidate));
            modelFile = join(dir, candidate);
            break;
          } catch {
            // try next candidate
          }
        }
      }

      if (!modelFile) return null;

      return {
        modelPath: modelFile,
        headPath: headFile,
        manifestPath: manifestFile,
      };
    }

    if (s.isFile()) {
      dir = dirname(targetPath);
      const headFile = join(dir, "head.json");
      try {
        await stat(headFile);
        return {
          modelPath: targetPath,
          headPath: headFile,
        };
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function escapeUserText(text: string): string {
  return text.replace(/<\|([A-Za-z0-9_]+)\|>/g, "<¦$1¦>");
}

export class KevHead {
  readonly hiddenSize: number;
  readonly headDim: number;
  readonly temperature: number;
  private readonly qWeight: number[][];
  private readonly qBias: number[];
  private readonly kWeight: number[][];
  private readonly kBias: number[];

  constructor(data: KevHeadData) {
    this.hiddenSize = data.hidden_size;
    this.headDim = data.head_dim;
    this.temperature = data.temperature > 0 ? data.temperature : 1.0;
    this.qWeight = data.q_weight;
    this.qBias = data.q_bias;
    this.kWeight = data.k_weight;
    this.kBias = data.k_bias;
  }

  private project(weight: number[][], bias: number[], hidden: number[]): Float64Array {
    const out = new Float64Array(this.headDim);
    for (let i = 0; i < this.headDim; i++) {
      let sum = bias[i]!;
      const row = weight[i]!;
      for (let j = 0; j < this.hiddenSize; j++) {
        sum += row[j]! * hidden[j]!;
      }
      out[i] = sum;
    }
    return out;
  }

  computeProbabilities(decideHidden: number[], optHiddens: number[][]): number[] {
    if (optHiddens.length === 0) return [];

    const query = this.project(this.qWeight, this.qBias, decideHidden);
    const scale = 1.0 / Math.sqrt(this.headDim);
    const logits = new Float64Array(optHiddens.length);

    let maxLogit = -Infinity;
    for (let i = 0; i < optHiddens.length; i++) {
      const key = this.project(this.kWeight, this.kBias, optHiddens[i]!);
      let dot = 0.0;
      for (let j = 0; j < this.headDim; j++) {
        dot += key[j]! * query[j]!;
      }
      const val = (dot * scale) / this.temperature;
      logits[i] = val;
      if (val > maxLogit) maxLogit = val;
    }

    const exps = new Float64Array(logits.length);
    let sum = 0.0;
    for (let i = 0; i < logits.length; i++) {
      exps[i] = Math.exp(logits[i]! - maxLogit);
      sum += exps[i]!;
    }

    const probs: number[] = new Array(logits.length);
    for (let i = 0; i < logits.length; i++) {
      probs[i] = exps[i]! / sum;
    }
    return probs;
  }
}

export class KevLocalContext implements EngineContext {
  private readonly sequence: LlamaContextSequence;
  private readonly stateToken: number[];
  private readonly qToken: number[];
  private readonly optStartToken: number[];
  private readonly optEndToken: number[];
  private readonly decideToken: number[];

  constructor(
    private readonly context: LlamaContext,
    private readonly model: LlamaModel,
    private readonly head: KevHead
  ) {
    this.sequence = context.getSequence();

    this.stateToken = Array.from(this.model.tokenize("<|fim_prefix|>", true));
    this.qToken = Array.from(this.model.tokenize("<|fim_middle|>", true));
    this.optStartToken = Array.from(this.model.tokenize("<|box_start|>", true));
    this.optEndToken = Array.from(this.model.tokenize("<|box_end|>", true));
    this.decideToken = Array.from(this.model.tokenize("<|fim_suffix|>", true));
  }

  async generate(_options: GenerationOptions): Promise<string> {
    throw new Error("Kev is a System One decision model that does not generate text; use classifyDirect.");
  }

  async classifyDirect(
    content: string,
    labels: Label[],
    signal?: AbortSignal,
    systemPrompt?: string
  ): Promise<ClassificationResult | null> {
    signal?.throwIfAborted();

    const criteria: Record<string, string> = {};
    for (const label of labels) {
      criteria[label.name] = label.description;
    }
    if (!criteria["NONE"]) {
      criteria["NONE"] = "Does not fit any category";
    }

    const cleanInstructions = systemPrompt
      ? systemPrompt.replace(/Output contract:[\s\S]*$/i, "").trim()
      : "Classify this document into one of the following categories, or NONE if none apply.";

    // Sort choice options for deterministic ordering
    const optionKeys = Object.keys(criteria).sort();
    const optionsText = optionKeys.map((k) => (criteria[k] ? `${k}: ${criteria[k]}` : k));

    // Tokenize state
    const stateBody = Array.from(this.model.tokenize(escapeUserText(content), false));
    const maxBody = MAX_STATE_TOKENS - this.stateToken.length;
    const truncatedBody = stateBody.length > maxBody ? stateBody.slice(0, maxBody) : stateBody;
    const stateTokens = [...this.stateToken, ...truncatedBody];

    // Tokenize question branch
    const instrTokens = Array.from(this.model.tokenize(escapeUserText(cleanInstructions), false));
    const branchTokens: number[] = [...this.qToken, ...instrTokens];
    const optEnds: number[] = [];

    for (const opt of optionsText) {
      branchTokens.push(...this.optStartToken);
      branchTokens.push(...Array.from(this.model.tokenize(escapeUserText(opt), false)));
      branchTokens.push(...this.optEndToken);
      optEnds.push(branchTokens.length - 1);
    }
    branchTokens.push(...this.decideToken);
    const decideIndex = branchTokens.length - 1;

    // Reset sequence history
    await this.sequence.clearHistory();

    // Evaluate state prefix
    signal?.throwIfAborted();
    await this.sequence.evaluateWithoutGeneratingNewTokens(stateTokens);

    // Evaluate options in chunks to capture each </opt> hidden state
    const optHiddens: number[][] = [];
    let currentOffset = 0;
    const addonCtx = (this.context as unknown as { _ctx: { getEmbedding(len: number): Float64Array | number[] } })._ctx;

    for (let i = 0; i < optEnds.length; i++) {
      signal?.throwIfAborted();
      const targetEnd = optEnds[i]!;
      const chunk = branchTokens.slice(currentOffset, targetEnd + 1);
      await this.sequence.evaluateWithoutGeneratingNewTokens(chunk);
      currentOffset = targetEnd + 1;

      const emb = Array.from(addonCtx.getEmbedding(chunk.length));
      optHiddens.push(emb);
    }

    // Evaluate remainder up to <decide> token
    signal?.throwIfAborted();
    const remainder = branchTokens.slice(currentOffset, decideIndex + 1);
    await this.sequence.evaluateWithoutGeneratingNewTokens(remainder);
    const decideHidden = Array.from(addonCtx.getEmbedding(remainder.length));

    // Compute pointer head probabilities
    const probs = this.head.computeProbabilities(decideHidden, optHiddens);
    if (probs.length === 0) {
      return null;
    }

    let bestIndex = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i]! > probs[bestIndex]!) {
        bestIndex = i;
      }
    }

    const selectedChoice = optionKeys[bestIndex];
    if (!selectedChoice || selectedChoice.toUpperCase() === "NONE") {
      return null;
    }

    const matchingLabel = labels.find((l) => l.name.toLowerCase() === selectedChoice.toLowerCase());
    if (!matchingLabel) {
      return null;
    }

    return {
      labels: [matchingLabel.name],
    };
  }

  async clearHistory(): Promise<void> {
    await this.sequence.clearHistory();
  }

  async dispose(): Promise<void> {
    try {
      await this.sequence.dispose();
    } finally {
      await this.context.dispose();
    }
  }
}

export class KevLocalModel implements EngineModel {
  constructor(
    private readonly model: LlamaModel,
    private readonly head: KevHead
  ) {}

  async createContext(): Promise<EngineContext> {
    const context = await (this.model as unknown as {
      createContext(options: { contextSize: number; _embeddings: boolean }): Promise<LlamaContext>;
    }).createContext({
      contextSize: MAX_CONTEXT,
      _embeddings: true,
    });
    return new KevLocalContext(context, this.model, this.head);
  }

  async dispose(): Promise<void> {
    await this.model.dispose();
  }
}

export class KevLocalDriver implements EngineDriver {
  private llama: Llama | null = null;
  private head: KevHead | null = null;

  constructor(
    private readonly bundle: KevBundlePaths,
    private readonly logger?: NativeLogCallback
  ) {}

  async loadModel(_modelPath?: string): Promise<EngineModel> {
    const headRaw = await readFile(this.bundle.headPath, "utf8");
    const headData = JSON.parse(headRaw) as KevHeadData;
    this.head = new KevHead(headData);

    this.llama ??= await getLlama({
      build: "never",
      usePrebuiltBinaries: true,
      logLevel: LlamaLogLevel.warn,
      logger: this.logger,
    });

    const model = await this.llama.loadModel({ modelPath: this.bundle.modelPath });
    return new KevLocalModel(model, this.head);
  }

  async dispose(): Promise<void> {
    if (this.llama) {
      await this.llama.dispose();
      this.llama = null;
    }
  }
}
