import { describe, expect, test } from "bun:test";
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
    const descriptionColumn = lines[0]!.indexOf("DESCRIPTION");

    expect(descriptionColumn).toBeGreaterThan(38);
    expect(lines.find((line) => line.startsWith("queue move"))?.indexOf("Reorder")).toBe(descriptionColumn);
    expect(lines.find((line) => line.startsWith("classify <folder> <labels.yaml> --reuse-context-command"))?.indexOf("Reuse")).toBe(descriptionColumn);
  });
});
