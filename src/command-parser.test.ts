import { describe, expect, test } from "vitest";
import { parseCommand } from "./command-parser.js";

describe("parseCommand", () => {
  test("parses quoted paths and force", () => {
    expect(parseCommand('classify "folder with spaces" labels.yaml --force')).toEqual({
      type: "classify",
      folder: "folder with spaces",
      labels: "labels.yaml",
      force: true,
    });
  });

  test("selects the default prompt", () => {
    expect(parseCommand("prompt default")).toEqual({ type: "prompt", path: null });
  });

  test("rejects incomplete commands", () => {
    expect(() => parseCommand("model")).toThrow("Usage: model <path>");
  });
});
