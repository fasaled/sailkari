import { describe, expect, test } from "vitest";
import { HELP_TEXT, parseCommand } from "./command-parser.js";

describe("parseCommand", () => {
  test("parses quoted paths and force", () => {
    expect(parseCommand('classify "folder with spaces" labels.yaml --force')).toEqual({
      type: "classify",
      folder: "folder with spaces",
      labels: "labels.yaml",
      force: true,
      contextReuse: "none",
    });
  });

  test("parses explicit file and command context reuse modes", () => {
    expect(parseCommand("classify documents labels.yaml --reuse-context-file")).toMatchObject({
      type: "classify",
      contextReuse: "file",
    });
    expect(parseCommand("classify documents labels.yaml --reuse-context-command")).toMatchObject({
      type: "classify",
      contextReuse: "command",
    });
  });

  test("selects the default prompt", () => {
    expect(parseCommand("prompt default")).toEqual({ type: "prompt", path: null });
  });

  test("rejects incomplete commands", () => {
    expect(() => parseCommand("model")).toThrow("Usage: model <path>");
  });

  test("formats help as an aligned command table", () => {
    const lines = HELP_TEXT.split("\n");

    expect(lines[0]).toBe("COMMAND                               DESCRIPTION");
    expect(lines.find((line) => line.startsWith("queue move"))?.indexOf("Reorder")).toBe(38);
  });
});
