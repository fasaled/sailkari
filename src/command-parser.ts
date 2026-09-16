export type Command =
  | { type: "model"; path: string }
  | { type: "prompt"; path: string | null }
  | { type: "classify"; folder: string; labels: string; force: boolean }
  | { type: "list-tags"; folder: string }
  | { type: "remove-tags"; folder: string }
  | { type: "help" }
  | { type: "quit" };

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  for (const match of input.matchAll(pattern)) {
    tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'])/g, "$1"));
  }
  return tokens;
}

function requireArgs(name: string, args: string[], count: number): void {
  if (args.length < count) {
    throw new Error(`Usage: ${name} ${count === 1 ? "<path>" : "<folder> <labels.yaml>"}`);
  }
}

export function parseCommand(input: string): Command {
  const tokens = tokenize(input.trim());
  const [name, ...args] = tokens;
  if (!name) throw new Error("Enter a command. Use `help` to see the available commands.");

  switch (name.toLowerCase()) {
    case "model":
      requireArgs(name, args, 1);
      return { type: "model", path: args[0]! };
    case "prompt":
      if (args.length === 0 || args[0] === "default") return { type: "prompt", path: null };
      return { type: "prompt", path: args[0]! };
    case "classify":
      requireArgs(name, args, 2);
      return { type: "classify", folder: args[0]!, labels: args[1]!, force: args.includes("--force") };
    case "list-tags":
      requireArgs(name, args, 1);
      return { type: "list-tags", folder: args[0]! };
    case "remove-tags":
      requireArgs(name, args, 1);
      return { type: "remove-tags", folder: args[0]! };
    case "help": return { type: "help" };
    case "quit":
    case "exit": return { type: "quit" };
    default: throw new Error(`Unknown command: ${name}`);
  }
}

export const HELP_TEXT = [
  "model <path.gguf>                  Load and save the model",
  "prompt <path|default>              Configure the system prompt",
  "classify <folder> <labels.yaml>    Classify a folder",
  "classify <folder> <labels.yaml> --force",
  "list-tags <folder>                 List stored classifications",
  "remove-tags <folder>               Remove stored classifications",
  "help                                Show this help",
  "quit                                Exit the application",
].join("\n");
