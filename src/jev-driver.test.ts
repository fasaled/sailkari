import { describe, expect, it, mock } from "bun:test";
import { JevCloudDriver, JevContext } from "./jev-driver.js";
import type { Label } from "./types.js";

describe("jev-driver", () => {
  const labels: Label[] = [
    { name: "invoice", description: "Billing and invoices" },
    { name: "tax", description: "Tax filings" },
  ];

  it("throws if initialized with empty API key", () => {
    expect(() => new JevCloudDriver("")).toThrow("requires a non-empty API key");
  });

  it("classifies document successfully returning matching label", async () => {
    const mockFetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("jev-latest");
      expect(body.state).toBe("Invoice #1234 for services rendered");
      expect(body.questions.classification.criteria.invoice).toBe("Billing and invoices");
      expect(body.questions.classification.criteria.NONE).toBe("Does not fit any category");

      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            classification: {
              type: "choice",
              choice: "invoice",
              confidence: 0.95,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const driver = new JevCloudDriver("test-api-key", { fetchFn: mockFetch as unknown as typeof fetch });
    const model = await driver.loadModel("jev");
    const context = await model.createContext();

    const result = await (context as JevContext).classifyDirect("Invoice #1234 for services rendered", labels);
    expect(result).toEqual({ labels: ["invoice"] });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await context.clearHistory();
    await context.dispose();
    await model.dispose();
    await driver.dispose();
  });

  it("returns null when model chooses NONE", async () => {
    const mockFetch = mock(async () => {
      return new Response(
        JSON.stringify({
          answers: {
            classification: {
              type: "choice",
              choice: "NONE",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const context = new JevContext("key", "https://api.typesafe.ai/v1/systemone", "jev-latest", mockFetch as unknown as typeof fetch);
    const result = await context.classifyDirect("Random unrelated text", labels);
    expect(result).toBeNull();
  });

  it("returns null when model returns label not in taxonomy", async () => {
    const mockFetch = mock(async () => {
      return new Response(
        JSON.stringify({
          answers: {
            classification: {
              type: "choice",
              choice: "unknown_category",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const context = new JevContext("key", "https://api.typesafe.ai/v1/systemone", "jev-latest", mockFetch as unknown as typeof fetch);
    const result = await context.classifyDirect("Some content", labels);
    expect(result).toBeNull();
  });

  it("throws authentication error on HTTP 401", async () => {
    const mockFetch = mock(async () => {
      return new Response(
        JSON.stringify({ error: "Invalid API key" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    });

    const context = new JevContext("bad-key", "https://api.typesafe.ai/v1/systemone", "jev-latest", mockFetch as unknown as typeof fetch);
    await expect(context.classifyDirect("Doc", labels)).rejects.toThrow("TypeSafe Jev authentication failed");
  });

  it("throws rate limit error on HTTP 429", async () => {
    const mockFetch = mock(async () => {
      return new Response(
        JSON.stringify({ error: { message: "Too many requests" } }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    });

    const context = new JevContext("key", "https://api.typesafe.ai/v1/systemone", "jev-latest", mockFetch as unknown as typeof fetch);
    await expect(context.classifyDirect("Doc", labels)).rejects.toThrow("rate limit exceeded");
  });

  it("throws if generate() is called directly", async () => {
    const context = new JevContext("key", "https://api.typesafe.ai/v1/systemone", "jev-latest", mock() as unknown as typeof fetch);
    await expect(context.generate({ prompt: "hi", systemPrompt: "test" })).rejects.toThrow("System One decision model");
  });

  it("respects AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    const context = new JevContext("key", "https://api.typesafe.ai/v1/systemone", "jev-latest", mock() as unknown as typeof fetch);
    await expect(context.classifyDirect("Doc", labels, controller.signal)).rejects.toThrow();
  });
});
