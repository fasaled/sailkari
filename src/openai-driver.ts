import type { EngineContext, EngineDriver, EngineModel, GenerationOptions } from "./llm-engine.js";

export const OPENAI_DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const GROQ_DEFAULT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const OPENROUTER_DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenAIDriverOptions {
  endpoint?: string;
  model: string;
  fetchFn?: typeof fetch;
}

interface OpenAIChatResponse {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
  error?: {
    message?: string;
    type?: string;
  };
}

export class OpenAICompatibleContext implements EngineContext {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch
  ) {}

  async generate(options: GenerationOptions): Promise<string> {
    options.signal?.throwIfAborted();

    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.prompt },
      ],
      temperature: 0,
      max_tokens: options.maxTokens ?? 64,
    };

    const response = await this.fetchFn(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as OpenAIChatResponse;
        if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // Fall back to status text
      }

      if (response.status === 401) {
        throw new Error(`Authentication failed (${this.endpoint}): ${errorMessage}. Check your API key.`);
      }
      if (response.status === 429) {
        throw new Error(`Rate limit exceeded (${this.endpoint}): ${errorMessage}`);
      }
      throw new Error(`API error (${response.status}): ${errorMessage}`);
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "NONE";
    options.onToken?.(content);
    return content;
  }

  async clearHistory(): Promise<void> {
    // Stateless HTTP context
  }

  async dispose(): Promise<void> {
    // Stateless HTTP context
  }
}

export class OpenAICompatibleModel implements EngineModel {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch
  ) {}

  async createContext(): Promise<EngineContext> {
    return new OpenAICompatibleContext(this.apiKey, this.endpoint, this.model, this.fetchFn);
  }

  async dispose(): Promise<void> {
    // No resources to dispose
  }
}

export class OpenAICompatibleDriver implements EngineDriver {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly apiKey: string,
    options: OpenAIDriverOptions
  ) {
    if (!apiKey || !apiKey.trim()) {
      throw new Error("OpenAICompatibleDriver requires a non-empty API key.");
    }
    this.model = options.model;
    this.endpoint = options.endpoint ?? OPENAI_DEFAULT_ENDPOINT;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async loadModel(_modelPath: string): Promise<EngineModel> {
    return new OpenAICompatibleModel(this.apiKey, this.endpoint, this.model, this.fetchFn);
  }

  async dispose(): Promise<void> {
    // No resources to dispose
  }
}
