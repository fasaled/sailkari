import { readFile } from "node:fs/promises";
import { test, expect, describe } from "bun:test";
import {
  DEFAULT_SYSTEM_PROMPT,
  buildChatMessages,
  buildUserPayload,
  inspectSystemPrompt,
} from "./prompt.js";
import type { Label } from "./types.js";

const labels: Label[] = [
  { name: "banking", description: "financial documents" },
  { name: "pets", description: "pet documents" },
];

describe("buildUserPayload", () => {
  test("puts labels and document in a fixed layout", () => {
    const payload = buildUserPayload(labels, "Account balance: $12");
    expect(payload).toContain("LABELS:");
    expect(payload).toContain("banking: financial documents");
    expect(payload).toContain("DOCUMENT:");
    expect(payload).toContain("Account balance: $12");
    expect(payload).not.toContain("ONLY the name");
  });
});

describe("buildChatMessages", () => {
  test("sends system prompt and user payload as two messages", () => {
    const messages = buildChatMessages("Be a classifier.", labels, "doc");
    expect(messages).toEqual([
      { role: "system", content: "Be a classifier." },
      { role: "user", content: buildUserPayload(labels, "doc") },
    ]);
  });
});

describe("inspectSystemPrompt", () => {
  test("built-in default has no warnings", () => {
    expect(inspectSystemPrompt(DEFAULT_SYSTEM_PROMPT)).toEqual([]);
  });

  test("example file matches the built-in default", async () => {
    const file = (await readFile("examples/system-prompt.txt", "utf8")).trim();
    expect(file).toBe(DEFAULT_SYSTEM_PROMPT.trim());
    expect(inspectSystemPrompt(file)).toEqual([]);
  });

  test("warns when the output contract is missing", () => {
    const warnings = inspectSystemPrompt(
      "Classify the document using your best judgment and explain why."
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join(" ")).toContain("format");
  });
});
