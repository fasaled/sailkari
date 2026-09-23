import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { detectKevBundle, KevHead } from "./kev-local-driver.js";
import { SailkariApplication } from "./application.js";
import type { Label } from "./types.js";

describe("kev-local-driver", () => {
  it("detects kev bundle from directory and file", async () => {
    const dirBundle = await detectKevBundle("models/kev-0.8b-gguf");
    expect(dirBundle).not.toBeNull();
    expect(dirBundle?.modelPath).toContain("model-f16.gguf");
    expect(dirBundle?.headPath).toContain("head.json");

    const fileBundle = await detectKevBundle("models/kev-0.8b-gguf/model-f16.gguf");
    expect(fileBundle).not.toBeNull();
    expect(fileBundle?.modelPath).toContain("model-f16.gguf");
    expect(fileBundle?.headPath).toContain("head.json");

    const nonKev = await detectKevBundle("models/qwen2.5-1.5b-instruct-q4_k_m.gguf");
    expect(nonKev).toBeNull();
  });

  it("computes softmax probabilities with KevHead correctly", () => {
    const head = new KevHead({
      format: 1,
      base: "test-base",
      hidden_size: 4,
      head_dim: 2,
      temperature: 1.0,
      q_weight: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
      ],
      q_bias: [0, 0],
      k_weight: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
      ],
      k_bias: [0, 0],
    });

    const decideHidden = [1, 0, 0, 0];
    const opt1Hidden = [1, 0, 0, 0];
    const opt2Hidden = [0, 1, 0, 0];

    const probs = head.computeProbabilities(decideHidden, [opt1Hidden, opt2Hidden]);
    expect(probs.length).toBe(2);
    expect(probs[0]!).toBeGreaterThan(probs[1]!);
    expect(probs[0]! + probs[1]!).toBeCloseTo(1.0, 5);
  });

  it("loads and classifies with local Kev bundle in SailkariApplication", async () => {
    const app = new SailkariApplication();
    const loadedPath = await app.loadModel("models/kev-0.8b-gguf");
    expect(loadedPath).toBe(resolve("models/kev-0.8b-gguf"));

    const labels: Label[] = [
      { name: "billing", description: "Charges, invoices, payment problems" },
      { name: "returns", description: "Exchanges, refunds, wrong or damaged items" },
      { name: "shipping", description: "Delivery status, delays, lost packages" },
    ];

    const result = await (app as unknown as { engine: { classify: Function } }).engine.classify(
      "Shoes arrived two weeks late and in the wrong size. Also I see two charges on my card.",
      labels
    );

    expect(result).not.toBeNull();
    expect(result?.labels).toEqual(["returns"]);
  });
});
