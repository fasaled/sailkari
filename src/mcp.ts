import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "node:path";
import { SailkariApplication } from "./application.js";
import { OUTPUT_CONTRACT } from "./prompt.js";
import { formatEvaluationTableRow } from "./evaluation-metrics.js";

const SYSTEM_PROMPT_GUIDANCE = `Sailkari classifies one document at a time from a supplied label taxonomy.

A compatible system prompt must:
- ask for exactly one label from the labels supplied in the user message;
- use label descriptions to decide the primary subject;
- return only the label name, with no explanation or extra text;
- return NONE when no label fits;
- never invent or combine labels.

${OUTPUT_CONTRACT}`;

interface McpState {
  application: SailkariApplication;
}

function jsonResult(value: Record<string, unknown>): { content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown> } {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function createState(): McpState {
  return { application: new SailkariApplication() };
}

export function createMcpServer(state = createState()): McpServer {
  const server = new McpServer({ name: "sailkari", version: "0.1.0" });

  server.registerResource(
    "system-prompt-contract",
    "sailkari://system-prompt-contract",
    { title: "Sailkari system prompt contract", description: "Output format and behavioral requirements for generated classification prompts.", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: SYSTEM_PROMPT_GUIDANCE }] }),
  );

  server.registerPrompt(
    "generate-system-prompt",
    {
      title: "Generate a Sailkari system prompt",
      description: "Ask an agent to generate a system prompt compatible with Sailkari's classifier parser.",
      argsSchema: { taxonomy: z.string().describe("Label names and descriptions that the prompt must classify") },
    },
    ({ taxonomy }) => ({
      description: "Generate a strict Sailkari classification system prompt.",
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Generate a system prompt for Sailkari using this taxonomy:\n\n${taxonomy}\n\nThe prompt must satisfy this contract:\n\n${SYSTEM_PROMPT_GUIDANCE}`,
        },
      }],
    }),
  );

  server.registerTool("load_model", {
    description: "Load an instruction-tuned GGUF model for subsequent Sailkari evaluations.",
    inputSchema: { modelPath: z.string().describe("Path to the GGUF model") },
  }, async ({ modelPath }) => {
    const loadedModelPath = await state.application.loadModel(modelPath);
    return jsonResult({ modelPath: loadedModelPath, loaded: true });
  });

  server.registerTool("set_system_prompt", {
    description: "Set the system prompt used for model evaluation. Read sailkari://system-prompt-contract first or use generate-system-prompt.",
    inputSchema: { systemPrompt: z.string().min(1).describe("Classifier system prompt") },
  }, async ({ systemPrompt }) => {
    const result = await state.application.setSystemPrompt(systemPrompt);
    return jsonResult({ warnings: result.warnings, configured: true });
  });

  server.registerTool("classify_documents", {
    description: "Evaluate text documents with the loaded GGUF model and return per-file and aggregate benchmark metrics.",
    inputSchema: {
      folder: z.string().describe("Folder containing documents to evaluate"),
      labels: z.string().describe("YAML label taxonomy path"),
      force: z.boolean().optional().default(false).describe("Run inference even when stored labels exist"),
      contextReuse: z.enum(["none", "file", "command"]).optional().default("none").describe("Context allocation scope"),
    },
  }, async ({ folder, labels, force, contextReuse }) => {
    if (!state.application.loadedModelPath) throw new Error("Load a model first with load_model.");
    const evaluation = await state.application.evaluate({ folder, labels, force, contextReuse });
    return jsonResult({
      modelPath: state.application.loadedModelPath,
      folder: evaluation.folder,
      contextReuse,
      results: evaluation.results.map((result) => ({ ...result, tableRow: formatEvaluationTableRow(result.filePath.split("/").pop() ?? result.filePath, result) })),
      summary: evaluation.summary,
    });
  });

  server.registerTool("list_classifications", {
    description: "List stored classification labels for a folder.",
    inputSchema: { folder: z.string().describe("Evaluated folder") },
  }, async ({ folder }) => {
    return jsonResult({ entries: state.application.listClassifications(folder) });
  });

  server.registerTool("remove_classifications", {
    description: "Remove stored classification labels from a folder.",
    inputSchema: { folder: z.string().describe("Evaluated folder") },
  }, async ({ folder }) => {
    const entries = state.application.removeClassifications(folder);
    return jsonResult({ removed: entries.length, folder: resolve(folder) });
  });

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
