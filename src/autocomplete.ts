import { readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { listCloudModels, listConfiguredProviders } from "./api-keys.js";
import type { SailkariConfig } from "./config.js";

const COMMANDS = ["model", "prompt", "classify", "list-tags", "remove-tags", "provider", "key", "queue", "cancel", "help", "quit"];
const PROVIDER_ACTIONS = ["set", "add-model", "remove-model", "get", "list", "remove"];
const KEY_ACTIONS = ["set", "get", "list", "remove"];

function currentToken(input: string): { before: string; token: string } {
  const match = input.match(/(?:^|\s)([^\s]*)$/);
  if (!match) return { before: input, token: "" };
  return { before: input.slice(0, input.length - match[1]!.length), token: match[1]! };
}

function pathCandidates(token: string, predicate: (path: string) => boolean, defaultBase = "."): string[] {
  const hasTrailingSeparator = token.endsWith("/");
  const base = !token ? defaultBase : hasTrailingSeparator ? token : token.includes("/") ? dirname(token) : defaultBase;
  const prefix = token && !hasTrailingSeparator ? basename(token) : "";
  const directory = resolve(base === "." && token.startsWith("/") ? "/" : base);
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith(prefix))
      .map((entry) => join(base, entry.name))
      .filter((candidate) => {
        try {
          return statSync(resolve(candidate)).isDirectory() || predicate(resolve(candidate));
        } catch {
          return false;
        }
      })
      .map((candidate) => candidate + (statSync(resolve(candidate)).isDirectory() ? "/" : ""));
  } catch {
    return [];
  }
}

export function completeInput(input: string, config?: SailkariConfig): string[] {
  const { before, token } = currentToken(input);
  if (!before && !token.includes("/")) {
    return COMMANDS.filter((command) => command.startsWith(token));
  }

  const command = input.trim().split(/\s+/)[0];
  const tokens = input.trim().split(/\s+/);
  const argumentIndex = tokens.length - 1 + (input.endsWith(" ") ? 1 : 0);

  const availableProviders = listConfiguredProviders(config);

  if (command === "model" && argumentIndex === 1) {
    const cloudModels = listCloudModels(config);
    const cloudCandidates = new Set<string>(cloudModels.map((m) => m.id));

    // Also offer <provider>: for quick typing
    for (const p of availableProviders) {
      cloudCandidates.add(`${p}:`);
    }

    const matchingCloud = Array.from(cloudCandidates).filter((name) => name.toLowerCase().startsWith(token.toLowerCase()));
    const fileCandidates = pathCandidates(token, (path) => extname(path).toLowerCase() === ".gguf");
    return [...matchingCloud, ...fileCandidates];
  }
  if (command === "provider" && argumentIndex === 1) {
    return PROVIDER_ACTIONS.filter((action) => action.startsWith(token.toLowerCase()));
  }
  if (
    command === "provider" &&
    argumentIndex === 2 &&
    ["set", "add-model", "remove-model", "get", "remove", "delete"].includes(tokens[1]?.toLowerCase() ?? "")
  ) {
    return availableProviders.filter((provider) => provider.startsWith(token.toLowerCase()));
  }
  if (command === "key" && argumentIndex === 1) {
    return KEY_ACTIONS.filter((action) => action.startsWith(token.toLowerCase()));
  }
  if (command === "key" && argumentIndex === 2 && ["set", "get", "remove", "delete"].includes(tokens[1]?.toLowerCase() ?? "")) {
    return availableProviders.filter((provider) => provider.startsWith(token.toLowerCase()));
  }
  if (command === "prompt" && argumentIndex === 1) {
    return pathCandidates(token, (path) => statSync(path).isFile());
  }
  if (command === "classify" && argumentIndex === 1) {
    return pathCandidates(token, (path) => statSync(path).isDirectory());
  }
  if (command === "classify" && argumentIndex === 2) {
    return pathCandidates(token, (path) => [".yaml", ".yml"].includes(extname(path).toLowerCase()));
  }
  if ((command === "list-tags" || command === "remove-tags") && argumentIndex === 1) {
    return pathCandidates(token, (path) => statSync(path).isDirectory());
  }
  return [];
}

export function applyCompletion(input: string, completion: string): string {
  const { before } = currentToken(input);
  return before + completion;
}

export interface VisibleSuggestionsWindow {
  items: { text: string; originalIndex: number; isSelected: boolean }[];
  hasPrevious: boolean;
  hasNext: boolean;
  startIndex: number;
  endIndex: number;
}

/**
 * Calculates a sliding window of suggestions that fit within maxWidth (in characters).
 * When not all suggestions fit, it ensures the selected suggestion stays visible.
 * As the user cycles through options and passes the middle of the currently visible set,
 * the window shifts so that the selected word stays around the center and hidden options scroll in.
 */
export function getVisibleSuggestionsWindow(
  suggestions: string[],
  selectedIndex: number,
  maxWidth: number,
  gap = 2
): VisibleSuggestionsWindow {
  if (suggestions.length === 0 || maxWidth <= 0) {
    return { items: [], hasPrevious: false, hasNext: false, startIndex: 0, endIndex: 0 };
  }

  const clampedSelected = Math.max(0, Math.min(selectedIndex, suggestions.length - 1));

  // If all suggestions fit completely with gaps, return all directly
  const totalLength = suggestions.reduce((sum, s, idx) => sum + s.length + (idx > 0 ? gap : 0), 0);
  if (totalLength <= maxWidth) {
    return {
      items: suggestions.map((text, idx) => ({
        text,
        originalIndex: idx,
        isSelected: idx === clampedSelected,
      })),
      hasPrevious: false,
      hasNext: false,
      startIndex: 0,
      endIndex: suggestions.length - 1,
    };
  }

  // Helper to measure width required for a range [start, end]
  // with indicator ellipsis ("... " if start > 0 and " ..." if end < suggestions.length - 1)
  const measureRange = (start: number, end: number): number => {
    let width = 0;
    if (start > 0) width += 4; // "... "
    for (let i = start; i <= end; i++) {
      width += suggestions[i]!.length;
      if (i < end) width += gap;
    }
    if (end < suggestions.length - 1) width += 4; // " ..."
    return width;
  };

  // Find the maximum span [0, maxEndFromZero] that fits from the start
  let initEnd = 0;
  while (initEnd + 1 < suggestions.length && measureRange(0, initEnd + 1) <= maxWidth) {
    initEnd++;
  }

  const initialVisibleCount = Math.max(1, initEnd + 1);
  const midpoint = Math.floor(initialVisibleCount / 2);

  let startIndex = 0;
  if (clampedSelected <= midpoint) {
    startIndex = 0;
  } else {
    // Shift start so that clampedSelected stays near the midpoint
    startIndex = clampedSelected - midpoint;
  }

  // Ensure [startIndex, endIndex] contains clampedSelected and fits maxWidth
  startIndex = Math.max(0, Math.min(startIndex, clampedSelected));

  let endIndex = clampedSelected;
  // Grow endIndex to the right as much as fits
  while (endIndex + 1 < suggestions.length && measureRange(startIndex, endIndex + 1) <= maxWidth) {
    endIndex++;
  }

  // If we reached the end or have extra space, expand to the left as much as fits
  while (startIndex > 0 && measureRange(startIndex - 1, endIndex) <= maxWidth) {
    startIndex--;
  }

  // If even a single item plus arrows exceeds maxWidth, truncate or fit minimally
  while (startIndex < clampedSelected && measureRange(startIndex, endIndex) > maxWidth) {
    startIndex++;
  }
  while (endIndex > clampedSelected && measureRange(startIndex, endIndex) > maxWidth) {
    endIndex--;
  }

  const hasPrev = startIndex > 0;
  const hasNext = endIndex < suggestions.length - 1;

  const items = [];
  for (let i = startIndex; i <= endIndex; i++) {
    items.push({
      text: suggestions[i]!,
      originalIndex: i,
      isSelected: i === clampedSelected,
    });
  }

  return {
    items,
    hasPrevious: hasPrev,
    hasNext,
    startIndex,
    endIndex,
  };
}

