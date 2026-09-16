import { describe, expect, test, vi } from "vitest";
import {
  LLMEngine,
  type EngineContext,
  type EngineDriver,
  type EngineModel,
} from "./llm-engine.js";

function createDriver(response = "banking") {
  const context: EngineContext = {
    generate: vi.fn(async ({ onToken }) => {
      onToken?.(response);
      return response;
    }),
    dispose: vi.fn(async () => {}),
  };
  const model: EngineModel = {
    createContext: vi.fn(async () => context),
    dispose: vi.fn(async () => {}),
  };
  const driver: EngineDriver = {
    loadModel: vi.fn(async () => model),
    dispose: vi.fn(async () => {}),
  };
  return { driver, model, context };
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
    expect(model.createContext).toHaveBeenCalledOnce();
    expect(result).toBe("pets");
    expect(chunks).toEqual(["pets"]);
    expect(context.dispose).toHaveBeenCalledOnce();
  });

  test("releases a context when generation fails", async () => {
    const { driver, context } = createDriver();
    vi.mocked(context.generate).mockRejectedValueOnce(new Error("generation failed"));
    const engine = new LLMEngine(driver);
    await engine.loadModel("/models/test.gguf");

    await expect(
      engine.generate({ systemPrompt: "Classify.", prompt: "document" })
    ).rejects.toThrow("generation failed");
    expect(context.dispose).toHaveBeenCalledOnce();
  });

  test("classifies parsed output and reports progress", async () => {
    const { driver } = createDriver("BANKING");
    const engine = new LLMEngine(driver);
    const progress = vi.fn();
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

  test("disposes the model and native driver exactly once", async () => {
    const { driver, model } = createDriver();
    const engine = new LLMEngine(driver);
    await engine.loadModel("/models/test.gguf");

    await engine.dispose();
    await engine.dispose();

    expect(model.dispose).toHaveBeenCalledOnce();
    expect(driver.dispose).toHaveBeenCalledOnce();
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
