#!/usr/bin/env node

import { scanFolder } from "./file-scanner.js";
import { loadLabels, processFile } from "./classifier.js";
import { logProgress, logSummary } from "./logger.js";
import { LLMEngine } from "./llm-engine.js";
import { getAllTags, removeOwnTags, hasAIClassifiedTag } from "./xattr.js";
import { watchFolder } from "./watcher.js";
import { inspectSystemPrompt, loadSystemPrompt } from "./prompt.js";
import type { ProcessingSummary } from "./types.js";

interface GlobalFlags {
  help: boolean;
}

interface ClassifyCommand extends GlobalFlags {
  folder: string;
  labels: string;
  model: string;
  systemPrompt: string;
  force: boolean;
  watch: boolean;
}

type Command =
  | { cmd: "classify"; args: ClassifyCommand }
  | { cmd: "list-tags"; folder: string }
  | { cmd: "remove-tags"; folder: string }
  | { cmd: "help" };

function printHelp(): void {
  console.log(`
Sailkari — PoC harness for local GGUF models and system prompts

Usage:
  sailkari classify [options]           Classify files in a folder
  sailkari list-tags <path>              List tags for files in a folder
  sailkari remove-tags <path>            Remove AI tags from files in a folder
  sailkari help                          Show this help message

Commands:
  classify [options]    Classify files in a folder
    --folder, -f        Path to the folder to process (required)
    --labels, -l         Path to the YAML file with label definitions (required)
    --model, -m         Path to the GGUF model file (required)
    --system-prompt, -s Optional system prompt file (compare prompts / models)
    --force             Reprocess files already classified
    --watch, -w         Keep the model loaded and auto-classify new files
    --help, -h          Show help for this command

  list-tags <path>      List tags for all files in a folder

  remove-tags <path>    Remove AI tags from all files in a folder

Examples:
  # Classify files (model loads and unloads automatically)
  sailkari classify --folder ./docs --labels labels.yaml --model model.gguf

  # Evaluate a custom system prompt against a model
  sailkari classify --folder ./docs --labels labels.yaml --model model.gguf --system-prompt prompt.txt

  # Force reprocess all files
  sailkari classify --folder ./docs --labels labels.yaml --model model.gguf --force

  # Watch folder for new files and classify automatically
  sailkari classify --folder ./docs --labels labels.yaml --model model.gguf --watch

  # List tags
  sailkari list-tags ./docs

  # Remove AI tags
  sailkari remove-tags ./docs
`);
}

function printClassifyHelp(): void {
  console.log(`
classify - Classify files in a folder with the local in-process model

Usage:
  sailkari classify --folder <path> --labels <yaml> --model <path>
  sailkari classify --folder <path> --labels <yaml> --model <path> --watch

Options:
  --folder, -f <path>         Path to the folder to process (required)
  --labels, -l <yaml>         Path to the YAML file with label definitions (required)
  --model, -m <path>          Path to the GGUF model file (required)
  --system-prompt, -s <file>  Optional system prompt file (PoC: try a prompt vs the built-in default).
                              Must ask for exactly one label name (see README).
  --force                     Reprocess files already classified by this tool
  --watch, -w                 Keep server running and auto-classify new files
  --help, -h                  Show this help message

Examples:
  sailkari classify --folder ./examples/documents --labels examples/labels.yaml --model models/your-model.gguf
  sailkari classify --folder ./examples/documents --labels examples/labels.yaml --model models/your-model.gguf --system-prompt examples/system-prompt.txt
  sailkari classify --folder ./examples/documents --labels examples/labels.yaml --model models/your-model.gguf --watch
`);
}

function parseGlobalFlags(args: string[]): { flags: GlobalFlags; remaining: string[] } {
  const flags: GlobalFlags = { help: false };
  const remaining: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      i++;
    } else {
      remaining.push(arg);
      i++;
    }
  }

  return { flags, remaining };
}

function parseCommand(args: string[]): Command | null {
  if (args.length === 0) {
    printHelp();
    return null;
  }

  const subcommand = args[0]!;

  switch (subcommand) {
    case "help":
    case "--help":
    case "-h":
      return { cmd: "help" };

    case "classify":
    case "-c": {
      const { flags, remaining } = parseGlobalFlags(args.slice(1));
      if (flags.help) {
        printClassifyHelp();
        return null;
      }
      const folderFlagIdx = remaining.findIndex((a) => a === "--folder" || a === "-f");
      const labelsFlagIdx = remaining.findIndex((a) => a === "--labels" || a === "-l");
      const modelFlagIdx = remaining.findIndex((a) => a === "--model" || a === "-m");
      const systemPromptFlagIdx = remaining.findIndex((a) => a === "--system-prompt" || a === "-s");
      const nonFlagArgs = remaining.filter((a) => !a.startsWith("-"));
      return {
        cmd: "classify",
        args: {
          folder: folderFlagIdx !== -1 ? remaining[folderFlagIdx + 1] ?? "" : nonFlagArgs[0] || "",
          labels: labelsFlagIdx !== -1 ? remaining[labelsFlagIdx + 1] ?? "" : "",
          model: modelFlagIdx !== -1 ? remaining[modelFlagIdx + 1] ?? "" : nonFlagArgs[1] || "",
          systemPrompt: systemPromptFlagIdx !== -1 ? remaining[systemPromptFlagIdx + 1] || "" : "",
          force: remaining.includes("--force"),
          watch: remaining.includes("--watch") || remaining.includes("-w"),
          help: flags.help,
        },
      };
    }

    case "list-tags": {
      const nonFlag = args.slice(1).filter((a) => !a.startsWith("-"));
      return { cmd: "list-tags", folder: nonFlag[0] || "" };
    }

    case "remove-tags": {
      const nonFlag = args.slice(1).filter((a) => !a.startsWith("-"));
      return { cmd: "remove-tags", folder: nonFlag[0] || "" };
    }

    default:
      console.error(`Unknown command: ${subcommand}`);
      printHelp();
      process.exitCode = 1;
      return null;
  }
}

async function handleCommand(cmd: Command): Promise<void> {
  switch (cmd.cmd) {
    case "help":
      printHelp();
      break;

    case "classify": {
      if (!cmd.args.folder || !cmd.args.labels || !cmd.args.model) {
        console.error("Error: --folder, --labels, and --model are required");
        console.error("Usage: sailkari classify --folder <path> --labels <yaml> --model <path>");
        printClassifyHelp();
        process.exit(1);
      }

      const engine = new LLMEngine();
      try {
      const modelLoadStart = Date.now();
      console.log("Loading model (this may take a minute)...\n");
      await engine.loadModel(cmd.args.model);
      const modelLoadTime = Date.now() - modelLoadStart;

      let systemPrompt: string | undefined;
      if (cmd.args.systemPrompt) {
        systemPrompt = await loadSystemPrompt(cmd.args.systemPrompt);
        console.log("Using system prompt: " + cmd.args.systemPrompt);
        for (const warning of inspectSystemPrompt(systemPrompt)) {
          console.warn("Warning: " + warning);
        }
      } else {
        console.log("Using built-in system prompt");
      }

      console.log("Loading labels...");
      const labels = await loadLabels(cmd.args.labels);
      console.log(`Loaded ${labels.length} labels: ${labels.map((l) => l.name).join(", ")}`);

      console.log("Scanning folder...");
      const files = scanFolder(cmd.args.folder);
      console.log(`Found ${files.length} text files\n`);

      const startTime = new Date();
      const summary: ProcessingSummary = {
        processed: 0,
        tagged: 0,
        noLabel: 0,
        skipped: 0,
        totalTime: 0,
      };

      for (const filePath of files) {
        const result = await processFile(filePath, labels, cmd.args.force, engine, systemPrompt);
        logProgress(result, startTime, labels);

        if (result.status === "ok") {
          summary.processed++;
          summary.tagged++;
        } else if (result.status === "none") {
          summary.processed++;
          summary.noLabel++;
        } else if (result.status === "skip") {
          summary.skipped++;
        }
      }

      const processTime = Date.now() - startTime.getTime();
      summary.totalTime = Math.floor((modelLoadTime + processTime) / 1000);
      logSummary(summary);

      if (cmd.args.watch) {
        const ac = new AbortController();
        const watcher = await watchFolder({
          folder: cmd.args.folder,
          debounceMs: 750,
          signal: ac.signal,
          onFile: async (filePath) => {
            const r = await processFile(filePath, labels, cmd.args.force, engine, systemPrompt);
            logProgress(r, new Date(), labels);
          },
        });

        console.log(`\nWatching ${cmd.args.folder} for new files... (Ctrl+C to stop)\n`);

        const shutdown = async () => {
          console.log("\nStopping watcher...");
          ac.abort();
          try { watcher.close(); } catch {}
          await engine.dispose();
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);

        await new Promise(() => {});
      } else {
        // The model is released by the finally block.
      }
      } finally {
        await engine.dispose();
      }
      break;
    }

    case "list-tags": {
      if (!cmd.folder) {
        console.error("Error: folder path required");
        console.error("Usage: sailkari list-tags <path>");
        process.exit(1);
      }
      console.log("Listing tags for files in: " + cmd.folder + "\n");
      const files = scanFolder(cmd.folder);
      for (const filePath of files) {
        const filename = filePath.split("/").pop() || filePath;
        const tags = getAllTags(filePath);
        if (tags.length > 0) {
          console.log(filename.padEnd(40) + " → " + tags.join(", "));
        } else {
          console.log(filename.padEnd(40) + " → (no tags)");
        }
      }
      console.log("\n" + files.length + " files scanned");
      break;
    }

    case "remove-tags": {
      if (!cmd.folder) {
        console.error("Error: folder path required");
        console.error("Usage: sailkari remove-tags <path>");
        process.exit(1);
      }
      console.log("Removing tags from files in: " + cmd.folder + "\n");
      const files = scanFolder(cmd.folder);
      let removed = 0;
      for (const filePath of files) {
        const filename = filePath.split("/").pop() || filePath;
        const hadOwnTags = hasAIClassifiedTag(filePath);
        if (hadOwnTags) {
          removeOwnTags(filePath);
          console.log(filename.padEnd(40) + " → removed");
          removed++;
        } else {
          console.log(filename.padEnd(40) + " → (no AI tags to remove)");
        }
      }
      console.log("\nRemoved AI tags from " + removed + " files");
      break;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = parseCommand(args);

  if (!command) {
    return;
  }

  await handleCommand(command);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});