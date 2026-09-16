import type { ClassificationResult, Label } from "./types.js";

export function parseResponse(response: string, validLabels?: Label[]): ClassificationResult | null {
  if (!response || !validLabels) {
    return null;
  }

  const trimmed = response.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{")) {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonStr = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(jsonStr);
        return parseJsonResult(parsed, validLabels);
      } catch {
        // Fall through to text parsing
      }
    }
  }

  return parseTextResult(trimmed, validLabels);
}

function parseJsonResult(parsed: any, validLabels: Label[]): ClassificationResult | null {
  const labels: string[] = [];

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item.label === "string") {
        const matched = validLabels.find((l) => l.name.toLowerCase() === item.label.toLowerCase().trim());
        if (matched) {
          labels.push(matched.name);
        }
      }
    }
  } else if (parsed && Array.isArray(parsed.labels)) {
    const rawLabels = parsed.labels;

    for (let i = 0; i < rawLabels.length; i++) {
      const labelName = String(rawLabels[i]).toLowerCase().trim();
      const matched = validLabels.find((l) => l.name.toLowerCase() === labelName);
      if (matched) {
        labels.push(matched.name);
      }
    }
  }

  if (labels.length === 0) {
    return null;
  }

  return { labels };
}

function parseTextResult(text: string, validLabels: Label[]): ClassificationResult | null {
  const lowerText = text.toLowerCase();

  const scoredLabels: { name: string; score: number }[] = [];

  for (const label of validLabels) {
    const labelLower = label.name.toLowerCase();
    const index = lowerText.indexOf(labelLower);

    if (index !== -1) {
      let score = 10;

      if (index === 0 || /[\s\n\t,;:]/.test(text[index - 1]!)) {
        score += 5;
      }

      const endIndex = index + label.name.length;
      if (endIndex >= text.length || /[\s\n\t,;:.]/.test(text[endIndex]!)) {
        score += 5;
      }

      scoredLabels.push({ name: label.name, score });
    }
  }

  if (scoredLabels.length === 0) {
    return null;
  }

  scoredLabels.sort((a, b) => b.score - a.score);

  return {
    labels: [scoredLabels[0]!.name],
  };
}

export function selectLabelByMajority(labelCounts: Record<string, number>): string | null {
  const entries = Object.entries(labelCounts);
  if (entries.length === 0) {
    return null;
  }

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]![0];
}