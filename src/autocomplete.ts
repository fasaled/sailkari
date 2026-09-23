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
