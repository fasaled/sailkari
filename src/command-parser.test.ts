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

  test("parses key management commands", () => {
    expect(parseCommand("key set typesafe ts_my_key_123")).toEqual({
      type: "key",
      action: "set",
      provider: "typesafe",
      key: "ts_my_key_123",
    });

    expect(parseCommand("key get typesafe")).toEqual({
      type: "key",
      action: "get",
      provider: "typesafe",
    });

    expect(parseCommand("key list")).toEqual({
      type: "key",
      action: "list",
    });

    expect(parseCommand("key remove typesafe")).toEqual({
      type: "key",
      action: "remove",
      provider: "typesafe",
    });

    expect(parseCommand("key delete typesafe")).toEqual({
      type: "key",
      action: "remove",
      provider: "typesafe",
    });
  });

  test("rejects invalid key command syntax", () => {
    expect(() => parseCommand("key")).toThrow("Usage: key");
    expect(() => parseCommand("key set typesafe")).toThrow("Usage: key set");
    expect(() => parseCommand("key get")).toThrow("Usage: key get");
    expect(() => parseCommand("key remove")).toThrow("Usage: key remove");
    expect(() => parseCommand("key unknown")).toThrow("Unknown key action: unknown");
  });

  test("formats help as an aligned command table", () => {
    const lines = HELP_TEXT.split("\n");
    const descriptionColumn = lines[0]!.indexOf("DESCRIPTION");

    expect(descriptionColumn).toBeGreaterThan(38);
    expect(lines.find((line) => line.startsWith("queue move"))?.indexOf("Reorder")).toBe(descriptionColumn);
    expect(lines.find((line) => line.startsWith("classify <folder> <labels.yaml> --reuse-context-command"))?.indexOf("Reuse")).toBe(descriptionColumn);
  });
});
