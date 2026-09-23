import { parentPort } from "node:worker_threads";
import { basename, resolve } from "node:path";
import { SailkariApplication } from "./application.js";
import type { RunnableCommand } from "./command-queue.js";
import { formatEvaluationSummaryTable, formatEvaluationTableHeader, formatEvaluationTableRow, summarizeEvaluation } from "./evaluation-metrics.js";
import { isCloudModel } from "./api-keys.js";

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
const application = new SailkariApplication(nativeLogger);
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
      const isCloud = isCloudModel(command.path);
      const modelTarget = isCloud ? command.path : resolve(command.path);
      post({ type: "event", id, text: `Loading model: ${modelTarget}${isCloud ? " (cloud)" : ""}` });
      const loaded = await application.loadModel(modelTarget);
      signal.throwIfAborted();
      post({ type: "model-loaded", id, modelPath: loaded, isCloud });
    } else if (command.type === "prompt") {
      const prompt = await application.loadSystemPrompt(command.path);
      signal.throwIfAborted();
      post({ type: "prompt-loaded", id, prompt: prompt.prompt, systemPromptPath: prompt.path, warnings: prompt.warnings });
    } else if (command.type === "classify") {
      const evaluation = await application.evaluate({
        folder: command.folder,
        labels: command.labels,
        force: command.force,
        concurrency: command.concurrency,
        signal,
        onStart: (folder, fileCount) => {
          const targetStr = application.loadedModelPath ? ` [model: ${application.loadedModelPath}]` : "";
          const isCloud = application.loadedModelPath ? isCloudModel(application.loadedModelPath) : false;
          const effectiveConcurrency = command.concurrency ?? (isCloud ? 4 : 1);
          post({ type: "event", id, text: `Benchmarking ${fileCount} files in ${folder}${targetStr} (concurrency: ${effectiveConcurrency})` });
          for (const line of formatEvaluationTableHeader()) post({ type: "event", id, text: line, tone: "muted" });
        },
        onProgress: (filePath, current, total, message) => post({ type: "progress", id, text: `${basename(filePath)}: ${message} (${current}/${total})` }),
        onResult: (result) => {
          const name = basename(result.filePath);
          post({ type: "event", id, text: formatEvaluationTableRow(name, result), tone: result.status === "ok" ? "success" : result.status === "skip" ? "muted" : undefined });
        },
      });
      for (const line of formatEvaluationSummaryTable(evaluation.summary)) post({ type: "event", id, text: line, tone: "success" });
    } else if (command.type === "list-tags" || command.type === "remove-tags") {
      const entries = application.listClassifications(command.folder);
      if (command.type === "remove-tags") application.removeClassifications(command.folder);
      for (const entry of entries) {
        signal.throwIfAborted();
        const meta = entry.model || entry.provider ? ` [${[entry.provider, entry.model].filter(Boolean).join(":")}]` : "";
        if (command.type === "list-tags") post({ type: "event", id, text: `${basename(entry.filePath)} -> ${entry.labels.join(", ") || "no label"}${meta}` });
        else {
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