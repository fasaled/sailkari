import { readFile } from "node:fs/promises";
import type { Label } from "./types.js";

/**
 * The parser accepts:
 *   - a bare label name (preferred): banking
 *   - JSON: {"labels":["banking"]}  or  [{"label":"banking"}]
 *
 * A system prompt used with this CLI must tell the model to produce
 * one of those shapes. Otherwise replies become NONE even when the
 * classification itself is reasonable.
 */
export const OUTPUT_CONTRACT = `Output contract:
- Reply with ONLY the label name, matching a name from the list exactly.
- No quotes, no markdown, no punctuation, no explanation, no extra lines.
- Do not invent labels. Do not repeat the label description.
- If no label fits, reply with NONE.`;

export const DEFAULT_SYSTEM_PROMPT = `You are a document classifier.

The user message contains a list of labels (each with a name and a description) and one document.

Assign the document to exactly one label from that list. Use the descriptions as the definition of each category. If two labels could apply, pick the one that matches the document's primary subject, not its file format.

${OUTPUT_CONTRACT}`;

export function buildUserPayload(labels: Label[], document: string): string {
  const labelsText = labels.map((l) => l.name + ": " + l.description).join("\n");
  return "LABELS:\n" + labelsText + "\n\nDOCUMENT:\n" + document;
}

export function buildChatMessages(
  systemPrompt: string,
  labels: Label[],
  document: string
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildUserPayload(labels, document) },
  ];
}

export function inspectSystemPrompt(text: string): string[] {
  const warnings: string[] = [];
  const lower = text.toLowerCase();

  const asksForSingleLabel =
    /exactly one/.test(lower) ||
    /one label/.test(lower) ||
    /single label/.test(lower) ||
    /only the label/.test(lower) ||
    /only the name/.test(lower);

  const constrainsFormat =
    /only the label/.test(lower) ||
    /only the name/.test(lower) ||
    /no explanation/.test(lower) ||
    /no markdown/.test(lower) ||
    /no preamble/.test(lower) ||
    /output contract/.test(lower) ||
    (/\bjson\b/.test(lower) && /\blabels\b/.test(lower));

  if (!asksForSingleLabel) {
    warnings.push(
      "System prompt does not clearly ask for exactly one label from the provided list."
    );
  }
  if (!constrainsFormat) {
    warnings.push(
      "System prompt does not constrain the reply format. The parser expects a bare label name (or JSON {\"labels\":[\"name\"]}). Unconstrained replies are recorded as NONE."
    );
  }
  return warnings;
}

export async function loadSystemPrompt(path: string): Promise<string> {
  const text = (await readFile(path, "utf8")).trim();
  if (!text) {
    throw new Error(`System prompt file is empty: ${path}`);
  }
  return text;
}
