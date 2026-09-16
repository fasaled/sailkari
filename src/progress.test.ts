import { test, expect, describe, afterEach, beforeEach } from "vitest";
import { startProgress, updateProgress, finishProgress, clearProgress } from "./progress.js";

describe("progress bar", () => {
  let originalWrite: typeof process.stdout.write;
  let chunks: string[];

  beforeEach(() => {
    originalWrite = process.stdout.write.bind(process.stdout);
    chunks = [];
    process.stdout.write = ((chunk: any) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as any;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    clearProgress();
  });

  function getOutput(): string {
    return chunks.join("");
  }

  test("startProgress writes a bar at 0%", () => {
    startProgress("test.txt", 1, "starting");
    const output = getOutput();
    expect(output).toContain("test.txt");
    expect(output).toContain("[");
    expect(output).toContain("]");
    expect(output).toContain("0%");
    expect(output).toContain("starting");
  });

  test("updateProgress updates the bar", () => {
    startProgress("test.txt", 1, "starting");
    updateProgress("test.txt", 0, 3, "chunk 1/3");
    const output = getOutput();
    expect(output).toContain("chunk 1/3");
    updateProgress("test.txt", 3, 3, "finalizing");
    expect(getOutput()).toContain("100%");
    expect(getOutput()).toContain("finalizing");
  });

  test("updateProgress pads with spaces when message shortens", () => {
    startProgress("test.txt", 1, "classifying");
    const before = chunks.join("");
    const beforeLen = before.length;
    updateProgress("test.txt", 1, 1, "done");
    const after = getOutput().slice(beforeLen);
    expect(after.startsWith("\r")).toBe(true);
    expect(after).toContain("done");
    expect(after).toMatch(/done\s+$/);
  });

  test("finishProgress replaces the bar with the result line", () => {
    startProgress("test.txt", 1, "starting");
    finishProgress("[00:00] OK     test.txt                  → banking");
    const output = getOutput();
    expect(output).toContain("OK     test.txt");
    expect(output).toContain("banking");
    expect(output).toContain("\n");
  });

  test("finishProgress without active bar prints a new line", () => {
    finishProgress("[00:00] SKIP   test.txt");
    expect(getOutput()).toBe("[00:00] SKIP   test.txt\n");
  });

  test("bar fills proportionally to progress", () => {
    startProgress("a.txt", 1, "");
    updateProgress("a.txt", 0, 4, "");
    updateProgress("a.txt", 1, 4, "");
    updateProgress("a.txt", 2, 4, "");
    updateProgress("a.txt", 3, 4, "");
    updateProgress("a.txt", 4, 4, "");
    const output = getOutput();
    expect(output).toContain("0%");
    expect(output).toContain("25%");
    expect(output).toContain("50%");
    expect(output).toContain("75%");
    expect(output).toContain("100%");
  });

  test("long filenames are truncated", () => {
    const longName = "a".repeat(50) + ".txt";
    startProgress(longName, 1, "");
    const output = getOutput();
    expect(output).toContain("...");
    expect(output).not.toContain("a".repeat(50));
  });
});
