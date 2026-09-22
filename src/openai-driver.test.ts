import { describe, expect, it, mock } from "bun:test";
import { OpenAICompatibleDriver, OpenAICompatibleContext } from "./openai-driver.js";

describe("openai-driver", () => {
  it("throws if initialized with empty API key", () => {
    expect(() => new OpenAICompatibleDriver("", { model: "gpt-4o-mini" })).toThrow("requires a non-empty API key");
  });

  it("generates response from OpenAI-compatible API endpoint", async () => {
    const mockFetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.temperature).toBe(0);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].content).toBe("You are a classifier");
      expect(body.messages[1].content).toBe("Document text");

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "banking",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const driver = new OpenAICompatibleDriver("sk-test-key", {
      model: "gpt-4o-mini",
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    const model = await driver.loadModel("gpt-4o-mini");
    const context = await model.createContext();

    const onToken = mock();
    const result = await context.generate({
      systemPrompt: "You are a classifier",
      prompt: "Document text",
      onToken,
    });

    expect(result).toBe("banking");
    expect(onToken).toHaveBeenCalledWith("banking");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await context.clearHistory();
    await context.dispose();
    await model.dispose();
    await driver.dispose();
  });

  it("throws authentication error on 401", async () => {
    const mockFetch = mock(async () => {
      return new Response(
        JSON.stringify({ error: { message: "Invalid API key" } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    });

    const context = new OpenAICompatibleContext(
      "bad-key",
      "https://api.openai.com/v1/chat/completions",
      "gpt-4o-mini",
      mockFetch as unknown as typeof fetch
    );

    await expect(
      context.generate({ systemPrompt: "sys", prompt: "user" })
    ).rejects.toThrow("Authentication failed");
  });

  it("throws rate limit error on 429", async () => {
    const mockFetch = mock(async () => {
      return new Response(
        JSON.stringify({ error: { message: "Rate limit reached" } }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    });

    const context = new OpenAICompatibleContext(
      "key",
      "https://api.openai.com/v1/chat/completions",
      "gpt-4o-mini",
      mockFetch as unknown as typeof fetch
    );

    await expect(
      context.generate({ systemPrompt: "sys", prompt: "user" })
    ).rejects.toThrow("Rate limit exceeded");
  });

  it("respects AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    const context = new OpenAICompatibleContext(
      "key",
      "https://api.openai.com/v1/chat/completions",
      "gpt-4o-mini",
      mock() as unknown as typeof fetch
    );

    await expect(
      context.generate({ systemPrompt: "sys", prompt: "user", signal: controller.signal })
    ).rejects.toThrow();
  });
});
