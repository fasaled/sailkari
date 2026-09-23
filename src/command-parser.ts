export type Command =
  | { type: "model"; path: string }
  | { type: "prompt"; path: string | null }
  | { type: "classify"; folder: string; labels: string; force: boolean; concurrency?: number }
  | { type: "list-tags"; folder: string }
  | { type: "remove-tags"; folder: string }
  | { type: "provider"; action: "set"; provider: string; key?: string; endpoint?: string; driverType?: "jev" | "openai-compatible"; models?: string[] }
  | { type: "provider"; action: "add-model"; provider: string; model: string }
  | { type: "provider"; action: "remove-model"; provider: string; model: string }
  | { type: "provider"; action: "get"; provider: string }
  | { type: "provider"; action: "list" }
  | { type: "provider"; action: "remove"; provider: string }
  | { type: "key"; action: "set"; provider: string; key: string }
  | { type: "key"; action: "get"; provider: string }
  | { type: "key"; action: "list" }
  | { type: "key"; action: "remove"; provider: string }
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
    case "classify": {
      requireArgs(name, args, 2);

      let concurrency: number | undefined;
      for (let i = 2; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === "--concurrency" || arg === "-c") {
          const val = Number(args[++i]);
          if (!Number.isInteger(val) || val <= 0) {
            throw new Error("Concurrency must be a positive integer.");
          }
          concurrency = val;
        }
      }

      return {
        type: "classify",
        folder: args[0]!,
        labels: args[1]!,
        force: args.includes("--force"),
        concurrency,
      };
    }
    case "list-tags":
      requireArgs(name, args, 1);
      return { type: "list-tags", folder: args[0]! };
    case "remove-tags":
      requireArgs(name, args, 1);
      return { type: "remove-tags", folder: args[0]! };
    case "provider": {
      if (args.length === 0) {
        throw new Error("Usage: provider [set <name> [--key <key>] [--endpoint <url>] [--type <jev|openai>] [--models <m1,m2>] | add-model <name> <model> | remove-model <name> <model> | get <name> | list | remove <name>]");
      }
      const sub = args[0]!.toLowerCase();
      if (sub === "list") {
        return { type: "provider", action: "list" };
      }
      if (sub === "get") {
        if (args.length < 2) {
          throw new Error("Usage: provider get <name>");
        }
        return { type: "provider", action: "get", provider: args[1]! };
      }
      if (sub === "remove" || sub === "delete") {
        if (args.length < 2) {
          throw new Error("Usage: provider remove <name>");
        }
        return { type: "provider", action: "remove", provider: args[1]! };
      }
      if (sub === "add-model") {
        if (args.length < 3) {
          throw new Error("Usage: provider add-model <provider> <model>");
        }
        return { type: "provider", action: "add-model", provider: args[1]!, model: args[2]! };
      }
      if (sub === "remove-model") {
        if (args.length < 3) {
          throw new Error("Usage: provider remove-model <provider> <model>");
        }
        return { type: "provider", action: "remove-model", provider: args[1]!, model: args[2]! };
      }
      if (sub === "set") {
        if (args.length < 2) {
          throw new Error("Usage: provider set <name> [<key> [endpoint] [type] [models] | --key <key> --endpoint <url> --type <jev|openai> --models <m1,m2>]");
        }
        const providerName = args[1]!;
        let key: string | undefined;
        let endpoint: string | undefined;
        let driverType: "jev" | "openai-compatible" | undefined;
        let models: string[] | undefined;

        const remaining = args.slice(2);
        const hasFlags = remaining.some((arg) => arg.startsWith("-"));

        if (hasFlags) {
          for (let i = 0; i < remaining.length; i++) {
            const flag = remaining[i]!;
            if (flag === "--key" || flag === "-k" || flag === "-key") {
              key = remaining[++i];
              if (!key) throw new Error("Missing value for --key");
            } else if (flag === "--endpoint" || flag === "--url" || flag === "-endpoint" || flag === "-url" || flag === "-e") {
              endpoint = remaining[++i];
              if (!endpoint) throw new Error("Missing value for --endpoint");
            } else if (flag === "--type" || flag === "-type" || flag === "-t") {
              const t = remaining[++i]?.toLowerCase();
              if (t === "jev") driverType = "jev";
              else if (t === "openai" || t === "openai-compatible") driverType = "openai-compatible";
              else throw new Error("Invalid --type. Expected 'jev' or 'openai'");
            } else if (flag === "--models" || flag === "--model" || flag === "-models" || flag === "-model" || flag === "-m") {
              const mStr = remaining[++i];
              if (!mStr) throw new Error("Missing value for --models");
              models = mStr.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
            } else {
              throw new Error(`Unknown option: ${flag}`);
            }
          }
        } else {
          if (remaining.length >= 1) key = remaining[0];
          if (remaining.length >= 2) endpoint = remaining[1];
          if (remaining.length >= 3) {
            const t = remaining[2]!.toLowerCase();
            if (t === "jev") driverType = "jev";
            else if (t === "openai" || t === "openai-compatible") driverType = "openai-compatible";
            else throw new Error("Invalid driver type. Expected 'jev' or 'openai'");
          }
          if (remaining.length >= 4) {
            models = remaining[3]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
          }
        }

        return {
          type: "provider",
          action: "set",
          provider: providerName,
          key,
          endpoint,
          driverType,
          models,
        };
      }
      throw new Error(`Unknown provider action: ${args[0]}. Use set, add-model, remove-model, get, list, or remove.`);
    }
    case "key": {
      if (args.length === 0) {
        throw new Error("Usage: key [set <provider> <api_key> | get <provider> | list | remove <provider>]");
      }
      const sub = args[0]!.toLowerCase();
      if (sub === "list") {
        return { type: "key", action: "list" };
      }
      if (sub === "set") {
        if (args.length < 3) {
          throw new Error("Usage: key set <provider> <api_key>");
        }
        return { type: "key", action: "set", provider: args[1]!, key: args[2]! };
      }
      if (sub === "get") {
        if (args.length < 2) {
          throw new Error("Usage: key get <provider>");
        }
        return { type: "key", action: "get", provider: args[1]! };
      }
      if (sub === "remove" || sub === "delete") {
        if (args.length < 2) {
          throw new Error("Usage: key remove <provider>");
        }
        return { type: "key", action: "remove", provider: args[1]! };
      }
      throw new Error(`Unknown key action: ${args[0]}. Use set, get, list, or remove.`);
    }
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

const HELP_ENTRIES = [
  ["model <path.gguf|provider:model>", "Load GGUF or cloud model (e.g. jev, typesafe:jev, openrouter:meta-llama/llama-3)"],
  ["prompt <path|default>", "Configure the system prompt"],
  ["classify <folder> <labels.yaml>", "Classify a folder"],
  ["classify <folder> <labels.yaml> --force", "Reclassify every file"],
  ["classify <folder> <labels.yaml> --concurrency <n>", "Set parallel classification concurrency"],
  ["list-tags <folder>", "List stored classifications"],
  ["remove-tags <folder>", "Remove stored classifications"],
  ["provider set <name> [key] [url] [t] [m]", "Configure provider key, endpoint, driver type and models"],
  ["provider add-model <provider> <model>", "Associate a model with a provider"],
  ["provider remove-model <p> <model>", "Unassociate a model from a provider"],
  ["provider get <name>", "Show details, status and models for a provider"],
  ["provider list", "List all configured and detected providers"],
  ["provider remove <name>", "Remove a configured provider"],
  ["key set <provider> <key>", "Save API key for a provider"],
  ["key get <provider>", "Show configured API key for provider"],
  ["key list", "List configured providers"],
  ["key remove <provider>", "Remove API key for provider"],
  ["cancel", "Cancel the active operation"],
  ["queue", "List pending commands"],
  ["queue remove <n>", "Remove a pending command"],
  ["queue move <from> <to>", "Reorder pending commands"],
  ["queue clear", "Remove all pending commands"],
  ["help", "Show this help"],
  ["quit", "Exit Sailkari"],
] as const;

const HELP_COMMAND_WIDTH = Math.max(...HELP_ENTRIES.map(([command]) => command.length)) + 2;

export const HELP_TEXT = [
  "COMMAND".padEnd(HELP_COMMAND_WIDTH) + "DESCRIPTION",
  "-".repeat(HELP_COMMAND_WIDTH + "DESCRIPTION".length),
  ...HELP_ENTRIES.map(([command, description]) => command.padEnd(HELP_COMMAND_WIDTH) + description),
].join("\n");
