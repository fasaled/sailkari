import { parentPort } from "node:worker_threads";
import { basename, resolve } from "node:path";
import { ClassificationStore } from "./classification-store.js";
import { loadLabels, processFile } from "./classifier.js";
import { scanFolder } from "./file-scanner.js";
import { createLLMEngine, type EngineContext } from "./llm-engine.js";
import type { RunnableCommand } from "./command-queue.js";
import { DEFAULT_SYSTEM_PROMPT, inspectSystemPrompt, loadSystemPrompt } from "./prompt.js";
import { formatEvaluationSummaryTable, formatEvaluationTableHeader, formatEvaluationTableRow, summarizeEvaluation } from "./evaluation-metrics.js";

interface RunMessage {
  type: "run";
  id: number;
  command: RunnableCommand;
  systemPrompt: string;
}

let activeOperationId: number | null = null;
const nativeLogger = (level: string, message: string) => {
  const text = message.trim();
  if (activeOperationId !== null && text && !text.includes("llama_context: setting new yarn_attn_factor")) {
    post({ type: "native-log", id: activeOperationId, level, text });
  }
};
let engine = createLLMEngine(nativeLogger);
const controllers = new Map<number, AbortController>();

function post(message: object): void {
  parentPort?.postMessage(message);
}

async function run({ id, command, systemPrompt }: RunMessage): Promise<void> {
  const controller = new AbortController();
  controllers.set(id, controller);
  activeOperationId = id;
  const { signal } = controller;

  try {
    if (command.type === "model") {
      const modelPath = resolve(command.path);
      post({ type: "event", id, text: `Loading model: ${modelPath}` });
      await engine.dispose();
      engine = createLLMEngine(nativeLogger);
      await engine.loadModel(modelPath);
      signal.throwIfAborted();
      post({ type: "model-loaded", id, modelPath });
    } else if (command.type === "prompt") {
      if (command.path === null) {
        post({ type: "prompt-loaded", id, prompt: DEFAULT_SYSTEM_PROMPT, systemPromptPath: null, warnings: [] });
      } else {
        const systemPromptPath = resolve(command.path);
        const prompt = await loadSystemPrompt(systemPromptPath);
        signal.throwIfAborted();
        post({ type: "prompt-loaded", id, prompt, systemPromptPath, warnings: inspectSystemPrompt(prompt) });
      }
    } else if (command.type === "classify") {
      const startedAt = performance.now();
      const labels = await loadLabels(resolve(command.labels));
      const folder = resolve(command.folder);
      const store = new ClassificationStore(folder);
      const files = scanFolder(folder);
      const preparationMs = performance.now() - startedAt;
      const results = [];
      const commandContext = command.contextReuse === "command" ? await engine.createContext() : undefined;
      post({ type: "event", id, text: `Benchmarking ${files.length} files in ${folder} (${command.contextReuse === "none" ? "fresh context per call" : `reuse context per ${command.contextReuse}`})` });
      for (const line of formatEvaluationTableHeader()) post({ type: "event", id, text: line, tone: "muted" });
      try {
        for (const filePath of files) {
          signal.throwIfAborted();
          if (commandContext && results.length > 0) await commandContext.clearHistory();
          const fileContext: EngineContext | undefined = command.contextReuse === "file" ? await engine.createContext() : commandContext;
          try {
            const result = await processFile(filePath, labels, command.force, engine, store, systemPrompt, signal, () => {}, fileContext);
            results.push(result);
            const name = basename(filePath);
            post({ type: "event", id, text: formatEvaluationTableRow(name, result), tone: result.status === "ok" ? "success" : result.status === "skip" ? "muted" : undefined });
          } finally {
            if (command.contextReuse === "file") await fileContext?.dispose();
          }
        }
      } finally {
        await commandContext?.dispose();
      }
      const summary = summarizeEvaluation(results, performance.now() - startedAt, preparationMs);
      for (const line of formatEvaluationSummaryTable(summary)) post({ type: "event", id, text: line, tone: "success" });
    } else if (command.type === "list-tags" || command.type === "remove-tags") {
      const store = new ClassificationStore(resolve(command.folder));
      for (const entry of store.entries()) {
        signal.throwIfAborted();
        if (command.type === "list-tags") post({ type: "event", id, text: `${basename(entry.filePath)} -> ${entry.labels.join(", ") || "no label"}` });
        else {
          store.remove(entry.filePath);
          post({ type: "event", id, text: `${basename(entry.filePath)} -> removed`, tone: "success" });
        }
      }
    }
    post({ type: "done", id });
  } catch (error) {
    post({ type: signal.aborted ? "cancelled" : "error", id, text: error instanceof Error ? error.message : String(error) });
  } finally {
    controllers.delete(id);
    if (activeOperationId === id) activeOperationId = null;
  }
}

parentPort?.on("message", (message: RunMessage | { type: "cancel"; id: number }) => {
  if (message.type === "cancel") controllers.get(message.id)?.abort(new Error("Operation cancelled."));
  else void run(message);
});