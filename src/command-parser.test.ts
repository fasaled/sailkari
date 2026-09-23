import { describe, expect, test } from "bun:test";
import { HELP_TEXT, parseCommand } from "./command-parser.js";

describe("parseCommand", () => {
  test("parses quoted paths and force", () => {
    expect(parseCommand('classify "folder with spaces" labels.yaml --force')).toEqual({
      type: "classify",
      folder: "folder with spaces",
      labels: "labels.yaml",
      force: true,
      concurrency: undefined,
    });
  });

  test("parses explicit concurrency flag", () => {
    expect(parseCommand("classify documents labels.yaml --concurrency 6")).toMatchObject({
      type: "classify",
      concurrency: 6,
    });
    expect(parseCommand("classify documents labels.yaml -c 8")).toMatchObject({
      type: "classify",
      concurrency: 8,
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

  test("parses provider management commands", () => {
    expect(parseCommand("provider set typesafe ts_my_key_123")).toEqual({
      type: "provider",
      action: "set",
      provider: "typesafe",
      key: "ts_my_key_123",
      endpoint: undefined,
      driverType: undefined,
    });

    expect(parseCommand("provider set zen my_key https://api.opencode.ai/v1/systemone jev")).toEqual({
      type: "provider",
      action: "set",
      provider: "zen",
      key: "my_key",
      endpoint: "https://api.opencode.ai/v1/systemone",
      driverType: "jev",
    });

    expect(parseCommand("provider set zen --key my_key --endpoint https://api.opencode.ai/v1/systemone --type jev --models jev,fast")).toEqual({
      type: "provider",
      action: "set",
      provider: "zen",
      key: "my_key",
      endpoint: "https://api.opencode.ai/v1/systemone",
      driverType: "jev",
      models: ["jev", "fast"],
    });

    expect(parseCommand("provider set zen -k my_key -e https://api.opencode.ai/v1/systemone -t jev -m jev,fast")).toEqual({
      type: "provider",
      action: "set",
      provider: "zen",
      key: "my_key",
      endpoint: "https://api.opencode.ai/v1/systemone",
      driverType: "jev",
      models: ["jev", "fast"],
    });

    expect(parseCommand("provider set zen -key my_key -endpoint https://api.opencode.ai/v1/systemone -models jev")).toEqual({
      type: "provider",
      action: "set",
      provider: "zen",
      key: "my_key",
      endpoint: "https://api.opencode.ai/v1/systemone",
      driverType: undefined,
      models: ["jev"],
    });

    expect(parseCommand("provider add-model zen jev")).toEqual({
      type: "provider",
      action: "add-model",
      provider: "zen",
      model: "jev",
    });

    expect(parseCommand("provider remove-model zen jev")).toEqual({
      type: "provider",
      action: "remove-model",
      provider: "zen",
      model: "jev",
    });

    expect(parseCommand("provider get zen")).toEqual({
      type: "provider",
      action: "get",
      provider: "zen",
    });

    expect(parseCommand("provider list")).toEqual({
      type: "provider",
      action: "list",
    });

    expect(parseCommand("provider remove zen")).toEqual({
      type: "provider",
      action: "remove",
      provider: "zen",
    });
  });

  test("rejects invalid provider command syntax", () => {
    expect(() => parseCommand("provider")).toThrow("Usage: provider");
    expect(() => parseCommand("provider set")).toThrow("Usage: provider set");
    expect(() => parseCommand("provider get")).toThrow("Usage: provider get");
    expect(() => parseCommand("provider remove")).toThrow("Usage: provider remove");
    expect(() => parseCommand("provider unknown")).toThrow("Unknown provider action: unknown");
  });

  test("formats help as an aligned command table", () => {
    const lines = HELP_TEXT.split("\n");
    const descriptionColumn = lines[0]!.indexOf("DESCRIPTION");

    expect(descriptionColumn).toBeGreaterThan(38);
    expect(lines.find((line) => line.startsWith("queue move"))?.indexOf("Reorder")).toBe(descriptionColumn);
    expect(lines.find((line) => line.startsWith("classify <folder> <labels.yaml> --concurrency"))?.indexOf("Set")).toBe(descriptionColumn);
  });
});
