import { readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const COMMANDS = ["model", "prompt", "classify", "list-tags", "remove-tags", "help", "quit"];

function currentToken(input: string): { before: string; token: string } {
  const match = input.match(/(?:^|\s)([^\s]*)$/);
  if (!match) return { before: input, token: "" };
  return { before: input.slice(0, input.length - match[1]!.length), token: match[1]! };
}

function pathCandidates(token: string, predicate: (path: string) => boolean): string[] {
  const base = token ? dirname(token) : ".";
  const prefix = token ? basename(token) : "";
  const directory = resolve(base === "." && token.startsWith("/") ? "/" : base);
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith(prefix))
      .map((entry) => join(base, entry.name))
      .filter((candidate) => {
        try { return predicate(resolve(candidate)); } catch { return false; }
      })
      .map((candidate) => candidate + (statSync(resolve(candidate)).isDirectory() ? "/" : ""));
  } catch {
    return [];
  }
}

export function completeInput(input: string): string[] {
  const { before, token } = currentToken(input);
  if (!before && !token.includes("/")) {
    return COMMANDS.filter((command) => command.startsWith(token));
  }

  const command = input.trim().split(/\s+/)[0];
  const argumentIndex = input.trim().split(/\s+/).length - 1;
  if (command === "model" && argumentIndex === 1) {
    return pathCandidates(token, (path) => extname(path).toLowerCase() === ".gguf");
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
