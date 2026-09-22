import { describe, expect, test, mock } from "bun:test";
import {
  LLMEngine,
  type EngineContext,
  type EngineDriver,
  type EngineModel,
} from "./llm-engine.js";

function createDriver(response = "banking") {
  const generate = mock(async ({ onToken }: { onToken?: (chunk: string) => void } = {}) => {
    onToken?.(response);
    return response;
  });
  const context: EngineContext = {
    generate,
    clearHistory: mock(async () => {}),
    dispose: mock(async () => {}),
  };
  const model: EngineModel = {
    createContext: mock(async () => context),
    dispose: mock(async () => {}),
  };
  const driver: EngineDriver = {
    loadModel: mock(async () => model),
    dispose: mock(async () => {}),
  };
  return { driver, model, context, generate };
}

describe("LLMEngine", () => {
  test("requires a loaded model before creating a context", async () => {
    const { driver } = createDriver();
    const engine = new LLMEngine(driver);

    await expect(engine.createContext()).rejects.toThrow("No model is loaded");
  });

  test("loads a model and generates through a short-lived context", async () => {
    const { driver, model, context } = createDriver("pets");
    const engine = new LLMEngine(driver);

    await engine.loadModel("/models/test.gguf");
    const chunks: string[] = [];
    const result = await engine.generate({
      systemPrompt: "Classify.",
      prompt: "A veterinary record",
      onToken: (chunk) => chunks.push(chunk),
    });

    expect(driver.loadModel).toHaveBeenCalledWith("/models/test.gguf");
    expect(model.createContext).toHaveBeenCalledTimes(1);
    expect(result).toBe("pets");
    expect(chunks).toEqual(["pets"]);
    expect(context.dispose).toHaveBeenCalledTimes(1);
  });

  test("releases a context when generation fails", async () => {
    const { driver, context, generate } = createDriver();
    generate.mockRejectedValueOnce(new Error("generation failed"));
    const engine = new LLMEngine(driver);
    await engine.loadModel("/models/test.gguf");

    await expect(
      engine.generate({ systemPrompt: "Classify.", prompt: "document" })
    ).rejects.toThrow("generation failed");
    expect(context.dispose).toHaveBeenCalledTimes(1);
  });

  test("classifies parsed output and reports progress", async () => {
    const { driver } = createDriver("BANKING");
    const engine = new LLMEngine(driver);
    const progress = mock();
    await engine.loadModel("/models/test.gguf");

    const result = await engine.classify(
      "Account balance",
      [{ name: "banking", description: "financial documents" }],
      progress
    );

    expect(result).toEqual({ labels: ["banking"] });
    expect(progress).toHaveBeenNthCalledWith(1, 0, 1, "classifying");
    expect(progress).toHaveBeenNthCalledWith(2, 1, 1, "done");
  });

  test("reuses and clears a supplied context between chunks", async () => {
    const { driver, model, context } = createDriver();
    const engine = new LLMEngine(driver);
    await engine.loadModel("/models/test.gguf");
    const reusableContext = await engine.createContext();

    await engine.classifyChunked(
      "word ".repeat(7_000),
      [{ name: "banking", description: "financial documents" }],
      undefined,
      undefined,
      undefined,
      reusableContext
    );
    await reusableContext.dispose();

    expect(model.createContext).toHaveBeenCalledTimes(1);
    expect(context.generate).toHaveBeenCalledTimes(2);
    expect(context.clearHistory).toHaveBeenCalledTimes(1);
    expect(context.dispose).toHaveBeenCalledTimes(1);
  });

  test("disposes the model and native driver exactly once", async () => {
    const { driver, model } = createDriver();
    const engine = new LLMEngine(driver);
    await engine.loadModel("/models/test.gguf");

    await engine.dispose();
    await engine.dispose();

    expect(model.dispose).toHaveBeenCalledTimes(1);
    expect(driver.dispose).toHaveBeenCalledTimes(1);
  });

  test("rejects loading a second model without disposal", async () => {
    const { driver } = createDriver();
    const engine = new LLMEngine(driver);
    await engine.loadModel("/models/one.gguf");

    await expect(engine.loadModel("/models/two.gguf")).rejects.toThrow(
      "A model is already loaded"
    );
  });
});
