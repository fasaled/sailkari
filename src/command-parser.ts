export type Command =
  | { type: "model"; path: string }
  | { type: "prompt"; path: string | null }
  | { type: "classify"; folder: string; labels: string; force: boolean; contextReuse: "none" | "file" | "command" }
  | { type: "list-tags"; folder: string }
  | { type: "remove-tags"; folder: string }
  | { type: "cancel" }
  | { type: "queue"; action: "show" | "clear" | "remove" | "move"; position?: number; destination?: number }
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
      if (args.includes("--reuse-context-file") && args.includes("--reuse-context-command")) {
        throw new Error("Choose either --reuse-context-file or --reuse-context-command.");
      }
      return {
        type: "classify",
        folder: args[0]!,
        labels: args[1]!,
        force: args.includes("--force"),
        contextReuse: args.includes("--reuse-context-command") ? "command" : args.includes("--reuse-context-file") ? "file" : "none",
      };
    case "list-tags":
      requireArgs(name, args, 1);
      return { type: "list-tags", folder: args[0]! };
    case "remove-tags":
      requireArgs(name, args, 1);
      return { type: "remove-tags", folder: args[0]! };
    case "cancel": return { type: "cancel" };
    case "queue": {
      if (args.length === 0) return { type: "queue", action: "show" };
      if (args[0] === "clear") return { type: "queue", action: "clear" };
      const position = Number(args[1]);
      if (args[0] === "remove" && Number.isInteger(position) && position > 0) {
        return { type: "queue", action: "remove", position };
      }
      const destination = Number(args[2]);
      if (args[0] === "move" && Number.isInteger(position) && position > 0 && Number.isInteger(destination) && destination > 0) {
        return { type: "queue", action: "move", position, destination };
      }
      throw new Error("Usage: queue [clear|remove <position>|move <from> <to>]");
    }
    case "help": return { type: "help" };
    case "quit":
    case "exit": return { type: "quit" };
    default: throw new Error(`Unknown command: ${name}`);
  }
}

const HELP_COMMAND_WIDTH = 38;

const HELP_ENTRIES = [
  ["model <path.gguf>", "Load and save the model"],
  ["prompt <path|default>", "Configure the system prompt"],
  ["classify <folder> <labels.yaml>", "Classify a folder"],
  ["classify <folder> <labels.yaml> --force", "Reclassify every file"],
  ["classify <folder> <labels.yaml> --reuse-context-file", "Reuse context within each file"],
  ["classify <folder> <labels.yaml> --reuse-context-command", "Reuse context for the full command"],
  ["list-tags <folder>", "List stored classifications"],
  ["remove-tags <folder>", "Remove stored classifications"],
  ["cancel", "Cancel the active operation"],
  ["queue", "List pending commands"],
  ["queue remove <n>", "Remove a pending command"],
  ["queue move <from> <to>", "Reorder pending commands"],
  ["queue clear", "Remove all pending commands"],
  ["help", "Show this help"],
  ["quit", "Exit Sailkari"],
] as const;

export const HELP_TEXT = [
  "COMMAND".padEnd(HELP_COMMAND_WIDTH) + "DESCRIPTION",
  "-".repeat(HELP_COMMAND_WIDTH + "DESCRIPTION".length),
  ...HELP_ENTRIES.map(([command, description]) => command.padEnd(HELP_COMMAND_WIDTH) + description),
].join("\n");
