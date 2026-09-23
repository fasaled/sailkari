# Sailkari Design and Architecture

Living specification. Implement and maintain the codebase against this document.

---

## 1. Overview and Core Purpose

**Sailkari** (Basque for "the one who classifies") is a local-first GGUF document classifier and benchmarking harness. It runs entirely on-device, allowing engineers to compare small instruction-tuned language models (such as Llama, Gemma, Mistral, Qwen, and Phi) and system prompt variations across a corpus of documents against a user-defined YAML taxonomy.

Sailkari exposes **one application core** through **two presentation modes** from a single executable:

| Mode | Invocation | Target Audience | Primary I/O |
|---|---|---|---|
| **Terminal UI (TUI)** | `sailkari` | Human developers & benchmarkers | Full-screen interactive terminal (Ink / React) |
| **MCP Server** | `sailkari --mcp` | AI coding agents & automated pipelines | Standard JSON-RPC 2.0 over `stdio` |

---

## 2. System Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              CLI Router                                │
│                           (src/index.tsx)                              │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
            [argv has --mcp]                   [default / TUI]
                    │                                │
                    ▼                                ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│              MCP Server              │  │      Interactive TUI         │
│            (src/mcp.ts)              │  │       (src/tui.tsx)          │
│  @modelcontextprotocol/sdk (stdio)   │  │  Ink 7 + React (alt-screen)  │
└───────────────────┬──────────────────┘  └──────────────┬───────────────┘
                    │                                    │
                    │                             (Worker Thread IPC)
                    │                                    │
                    │                                    ▼
                    │                     ┌──────────────────────────────┐
                    │                     │       Operation Worker       │
                    │                     │  (src/operation-worker.ts)   │
                    │                     └──────────────┬───────────────┘
                    │                                    │
                    └──────────────────┬─────────────────┘
                                       │
                                       ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │                    SailkariApplication Core                      │
    │                      (src/application.ts)                        │
    ├──────────────────────────────────┬───────────────────────────────┤
    │  Model & Prompt Lifecycle        │  Directory Scanner & Evaluator│
    │  - loadModel(path)               │  - evaluate(options)          │
    │  - setSystemPrompt(text)         │  - listClassifications(path)  │
    │  - loadSystemPrompt(path)        │  - removeClassifications(path)│
    └─────────────────┬────────────────┴───────────────┬───────────────┘
                      │                                │
                      ▼                                ▼
    ┌──────────────────────────────────┐  ┌────────────────────────────┐
    │       LLM Engine Driver          │  │    Classification Pipeline │
    │      (src/llm-engine.ts)         │  │     (src/classifier.ts)    │
    ├──────────────────────────────────┤  ├────────────────────────────┤
    │  - NodeLlamaDriver (node-llama)  │  │  - Chunking & Token Budget │
    │  - JevCloudDriver (TypeSafe Jev) │  │  - Majority Voting         │
    │  - OpenAICompatibleDriver        │  │  - Output Parser           │
    │  - ChatSession / Direct Decision │  │                            │
    └──────────────────────────────────┘  └─────────────┬──────────────┘
                                                        │
                      ┌─────────────────────────────────┴──────────────┐
                      ▼                                                ▼
    ┌──────────────────────────────────┐  ┌────────────────────────────┐
    │       ClassificationStore        │  │     Evaluation Metrics     │
    │  (src/classification-store.ts)   │  │ (src/evaluation-metrics.ts)│
    ├──────────────────────────────────┤  ├────────────────────────────┤
    │  - .sailkari/results.json        │  │  - Latency breakdown       │
    │  - Atomic write & cache lookup   │  │  - Token / sec throughput  │
    └──────────────────────────────────┘  └────────────────────────────┘
```

---

## 3. Concurrency and Process Model

### 3.1 Main Thread vs. Worker Thread
- **Main Thread (TUI):** Runs React/Ink's reconciliation and terminal rendering loop at up to 60 fps. To ensure zero frame drops, keyboard lag, or cursor stutter, no synchronous filesystem walks or model inference occurs on the main thread.
- **Worker Thread (`src/operation-worker.ts`):** Spawned via Node.js `worker_threads`. Owns the active `SailkariApplication` instance, executes GGUF model loading, runs token generation, processes file batches, and calculates metrics.
- **IPC Protocol:** Main and worker exchange typed messages:
  - Main → Worker: `{ type: "run", id, command, systemPrompt }`
  - Worker → Main: `{ type: "event" | "progress" | "native-log" | "model-loaded" | "prompt-loaded" | "done" | "cancelled" | "error", id, ... }`
- **Cancellation:** The worker associates every running task with an `AbortController`. The user typing `cancel` triggers `controller.abort()`, throwing an `AbortError` that halts inference and chunk iteration immediately.

### 3.2 Command Queue and History
- **Queue (`src/command-queue.ts`):** Maintains a FIFO queue of commands entered while an operation is active. Supports inspection (`queue`), removal (`queue remove <pos>`), reordering (`queue move <from> <to>`), and clearing (`queue clear`).
- **History (`src/command-history.ts`):** Navigable via Up/Down arrow keys. Persisted across sessions in `~/.config/sailkari/config.json`.

---

## 4. Inference Engine and Context Lifecycle

Sailkari uses `node-llama-cpp` (v3) to execute local GGUF models directly in-process via Metal, CUDA, or CPU. For cloud-based evaluation, it utilizes specialized drivers (e.g. `JevCloudDriver` for TypeSafe Jev System One decision models) over HTTPS with native `fetch`.

### 4.1 Token Budgets and Context Limits
- `MAX_CONTEXT`: 32,768 tokens.
- `SYSTEM_RESERVE`: 1,024 tokens reserved for prompt formatting and instructions.
- `EFFECTIVE_LIMIT`: 31,744 tokens available for document text and chunking.

### 4.2 Concurrency and Connection Pooling
Sailkari features an adaptive concurrency architecture:

1. **HTTP Keep-Alive Connection Pooling (Cloud Models):**
   - Both `JevCloudDriver` and `OpenAICompatibleDriver` maintain persistent HTTP connections (`Connection: keep-alive`).
   - Sockets and TLS sessions are reused across sequential and parallel requests, eliminating round-trip handshake overhead (~200–500ms per file).
2. **Adaptive Concurrency:**
   - **Cloud Models:** Concurrency defaults to **4 parallel workers**, allowing multiple HTTP requests to be handled concurrently without saturating the remote gateway.
   - **Local GGUF Models:** Concurrency defaults to **1** to prevent VRAM memory exhaustion and GPU/CPU thread contention on consumer hardware.
   - **User Override:** Users can explicitly specify `--concurrency <N>` (or `-c <N>`) in the TUI/CLI or via MCP's `classify_documents` tool to parallelize any batch. Each parallel local worker instantiates its own isolated `LlamaContext`.
3. **Stateless Isolation:**
   - Every inference evaluation is strictly isolated and stateless. Context history is not leaked across documents.

---

## 5. Classification and Evaluation Pipeline

### 5.1 Supported Formats and Scanner (`src/file-scanner.ts`)
The scanner recursively locates plain-text files matching:
`.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.yml`, `.xml`, `.log`, `.conf`, `.config`, `.ini`, `.toml`, `.properties`.

Ignored directories: `.git`, `node_modules`, `.sailkari`, and hidden files/folders.

### 5.2 Chunking and Voting (`src/classifier.ts`)
1. **Pre-check:** If the file already has stored results in `.sailkari/results.json` and `--force` is not passed, the cached label is returned immediately and excluded from inference metrics.
2. **Chunking:** Files larger than chunk thresholds are split into sequential segments within `EFFECTIVE_LIMIT`.
3. **Inference:** Each chunk is evaluated against the system prompt and taxonomy.
4. **Majority Voting:** Chunk classifications are aggregated:
   - The label with the highest vote count wins.
   - If votes tie, the first valid non-`NONE` label is selected.
   - If all chunks return `NONE` or unparseable text, the final result is `NONE` (no match).

### 5.3 Output Contract and Parser (`src/parser.ts`)
The system prompt enforces a strict contract:
- Return exactly one label name matching the taxonomy, or `NONE`.
- No explanations, markdown formatting, or preamble.

The parser handles small-model variations gracefully:
- Bare label string (e.g. `banking`).
- JSON object (e.g. `{"label": "banking"}` or `{"labels": ["banking"]}`).
- JSON array (e.g. `["banking"]`).
- Any unrecognized text or unknown category cleanly returns `NONE`.

---

## 6. Storage and Persistence

### 6.1 Results Store (`src/classification-store.ts`)
Classifications are stored per evaluated directory in:
`<folder>/.sailkari/results.json`

Schema:
```json
{
  "version": 1,
  "files": {
    "relative/path/document.txt": {
      "labels": ["banking"]
    }
  }
}
```

Writes are atomic: content is written to a temporary sibling file and committed using `fs.renameSync`.

### 6.2 User Configuration (`src/config.ts`)
Global user settings are stored in:
`~/.config/sailkari/config.json`

Contains:
- `modelPath`: path to the last loaded GGUF model or cloud model identifier (`<provider>:<model>`).
- `systemPromptPath`: path to the active custom prompt file (if any).
- `commandHistory`: array of previously executed commands.
- `apiKeys`: legacy dictionary of API keys per provider (`typesafe`, etc.).
- `providers`: dynamic dictionary of provider configurations:
  - `apiKey`: secret token for the provider.
  - `endpoint`: custom base URL or endpoint.
  - `driverType`: `"jev"` or `"openai-compatible"`.
  - `models`: string array of models registered for this provider.
  - `description`: optional label/notes.

---

## 7. Interfaces

### 7.1 TUI Commands

```text
model <path.gguf|provider:model>   Load and persist GGUF or cloud model (e.g. zen:jev, openai:gpt-4o-mini)
prompt <path|default>              Set default or custom system prompt
classify <folder> <labels.yaml>   Classify documents in a folder
  [--force]                        Re-run inference even if cached
  [--concurrency <n>]              Number of parallel workers (default 4 for cloud, 1 for local)
list-tags <folder>                 List stored classifications
remove-tags <folder>               Remove stored classifications
provider set <name> [key] [url] [t] [m] Configure provider key, endpoint, driver type and models
provider add-model <p> <model>     Associate a model with a provider
provider remove-model <p> <model>  Unassociate a model from a provider
provider get <name>                Show status, endpoint, driver type and models for a provider
provider list                      List all configured/detected providers
provider remove <name>             Remove a configured provider
key set <provider> <key>           Save API key for a provider
key get <provider>                 Show configured API key for provider
key list                           List configured providers
key remove <provider>              Remove API key for provider
queue                              List queued commands
queue remove <pos>                 Remove command at position
queue move <from> <to>             Reorder pending commands
queue clear                        Clear all pending commands
cancel                             Cancel the active operation
help                               Display command reference
quit                               Exit application
```

### 7.2 MCP Server (`src/mcp.ts`)

Launched with `sailkari --mcp`. Exposes:

- **Tools:**
  - `list_models()`: Discovers available models (local models and cloud models explicitly associated via `<PROVIDER>_MODELS` or configured in the TUI).
  - `load_model({ modelPath: string })`: Loads a local GGUF model or an authorized cloud model (e.g. `zen:jev`, `openai:gpt-4o-mini`).
  - `set_system_prompt({ systemPrompt: string })`
  - `classify_documents({ folder: string, labels: string, force?: boolean, concurrency?: number })`
  - `list_classifications({ folder: string })`
  - `remove_classifications({ folder: string })`
- **Resources:**
  - `sailkari://system-prompt-contract`: Output contract guidelines and format specification.
- **Prompts:**
  - `generate-system-prompt({ taxonomy: string })`: Produces a prompt complying with Sailkari's parser contract.
- **Security & Authorization Invariant:** MCP strictly prevents credential management and model guessing. Agents can only see and load models explicitly authorized by the user/host via `<PROVIDER>_MODELS` or TUI configuration. Credentials must be pre-configured and are never exposed over JSON-RPC.

---

## 8. Telemetry and Evaluation Metrics

For every evaluated document, Sailkari computes:
- Total wall duration (`durationMs`)
- Inference duration (`inferenceMs`)
- Document size (`sourceBytes`)
- Estimated input tokens (`inputTokensEstimate`)
- Model invocation count (`calls`) and chunk count (`chunks`)
- Throughput in input tokens per second

Aggregate evaluation summaries group results into:
- Outcomes: Labelled, No Match (`NONE`), and Cached
- Timing: Preparation time, total inference time, mean inference time per file
- Workload: Total bytes, total estimated tokens, and aggregate input tokens/sec
