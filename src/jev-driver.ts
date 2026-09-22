import type { ClassificationResult, Label } from "./types.js";
import type { EngineContext, EngineDriver, EngineModel, GenerationOptions } from "./llm-engine.js";

export const DEFAULT_JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_JEV_MODEL = "jev-latest";

export interface JevDriverOptions {
  endpoint?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

interface JevApiResponse {
  model?: string;
  answers?: {
    classification?: JevChoiceAnswer;
  };
  error?: string | { message?: string };
}

export class JevContext implements EngineContext {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch
  ) {}

  async generate(_options: GenerationOptions): Promise<string> {
    throw new Error("Jev is a System One decision model that does not generate text; use classifyDirect.");
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

    // Strip output contract boilerplate for Jev since it uses structured choice questions natively
    const cleanInstructions = systemPrompt
      ? systemPrompt.replace(/Output contract:[\s\S]*$/i, "").trim()
      : "Classify this document into one of the following categories, or NONE if none apply.";

    const payload = {
      state: content,
      model: this.model,
      questions: {
        classification: {
          type: "choice",
          instructions: cleanInstructions || "Classify this document into one of the following categories, or NONE if none apply.",
          criteria,
        },
      },
    };

    const response = await this.fetchFn(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json() as JevApiResponse;
        if (typeof errorData?.error === "string") {
          errorMessage = errorData.error;
        } else if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // Fall back to status text if response is not JSON
      }

      if (response.status === 401) {
        throw new Error(`TypeSafe Jev authentication failed: ${errorMessage}. Verify your API key.`);
      }
      if (response.status === 429) {
        throw new Error(`TypeSafe Jev rate limit exceeded: ${errorMessage}`);
      }
      throw new Error(`TypeSafe Jev API error (${response.status}): ${errorMessage}`);
    }

    const data = await response.json() as JevApiResponse;
    const answer = data.answers?.classification;
    if (!answer || answer.type !== "choice") {
      return null;
    }

    const selectedChoice = answer.choice?.trim();
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
    // Stateless cloud calls do not retain conversational history
  }

  async dispose(): Promise<void> {
    // Stateless HTTP context needs no memory teardown
  }
}

export class JevModel implements EngineModel {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch
  ) {}

  async createContext(): Promise<EngineContext> {
    return new JevContext(this.apiKey, this.endpoint, this.model, this.fetchFn);
  }

  async dispose(): Promise<void> {
    // Cloud model representation has no native handles to release
  }
}

export class JevCloudDriver implements EngineDriver {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly apiKey: string,
    options?: JevDriverOptions
  ) {
    if (!apiKey || !apiKey.trim()) {
      throw new Error("JevCloudDriver requires a non-empty API key.");
    }
    this.endpoint = options?.endpoint ?? DEFAULT_JEV_ENDPOINT;
    this.model = options?.model ?? DEFAULT_JEV_MODEL;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  async loadModel(_modelPath: string): Promise<EngineModel> {
    return new JevModel(this.apiKey, this.endpoint, this.model, this.fetchFn);
  }

  async dispose(): Promise<void> {
    // No driver resources to dispose
  }
}
