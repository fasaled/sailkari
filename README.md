# Sailkari

**Sailkari** (Basque for “the one who classifies”) is a local-first document classifier for
GGUF models. It runs in two modes from the same executable:

- a full-screen terminal UI for interactive benchmarking and classification workflows
- an MCP server over stdio for agent-based clients

Give it a corpus of text files and a YAML taxonomy, then run the same workload across models
to compare classification output, latency, throughput, chunking behavior, and context reuse.

Inference runs through [`node-llama-cpp`](https://github.com/withcatai/node-llama-cpp). The
model, corpus, prompts, and results remain on the local machine. Sailkari is intended for
evaluating model behavior and performance, not as a production classification service.

## Requirements

- Node.js 20 or newer
- An instruction-tuned GGUF model downloaded separately

The npm package includes the compatible llama.cpp native addon and libraries for the current
platform. npm picks the matching prebuilt package for your OS and architecture, so no
compiler setup is required for supported platforms.

Install from npm directly:

```bash
npm install --save-dev @fasaled/sailkari
npx @fasaled/sailkari
```

Sailkari works anywhere the native addon runs. It stores classifications in
`.sailkari/results.json` inside the evaluated folder, making repeated runs portable across
macOS, Linux, and Windows.

## Install and run

The package is published as `@fasaled/sailkari`, while the executable remains `sailkari`.

Run the full-screen terminal interface without a global installation:

```bash
npx @fasaled/sailkari
```

Or install globally:

```bash
npm install --global @fasaled/sailkari
sailkari help
```

Sailkari has two presentation modes in the same executable:

```bash
# Interactive terminal UI
sailkari

# MCP server over stdio for an external agent
sailkari --mcp
```

The TUI and MCP server share the same application core: model lifecycle, prompt management,
classification pipeline, context-reuse controls, result storage, and benchmark metrics. MCP only
changes the presentation layer. It exposes the same functionality to external clients through
standard MCP tools, resources, and prompts.

## MCP interface

When launched with `sailkari --mcp`, Sailkari exposes a standard MCP server over stdio.
Clients can discover and call the following tools:

- `list_models`: list available models (local models and cloud models with active credentials)
- `load_model`: load a local GGUF model from disk or an authorized cloud model (e.g. `jev`)
- `set_system_prompt`: set the classifier system prompt
- `classify_documents`: classify a folder using a YAML taxonomy and benchmark settings
- `list_classifications`: inspect stored labels for a folder
- `remove_classifications`: clear stored labels for a folder

> **Security guarantee:** The MCP server strictly forbids credential management. There are no tools to read, set, or delete API keys via MCP. External agents can inspect available model names (`list_models`) and invoke them (`load_model`), but secret keys are never exposed over JSON-RPC. Configure credentials beforehand via the TUI or pass them as environment variables (e.g., `TYPESAFE_API_KEY`).

The server also exposes the following resources and prompts:

- `sailkari://system-prompt-contract`: contract describing the valid output format for a
  classifier prompt
- `generate-system-prompt`: prompt helper that generates a compatible system prompt from a
  supplied taxonomy

This allows MCP clients to reuse the same model engine, prompt validation, classification flow,
and result storage without going through the interactive TUI.

## Architecture

Sailkari is a single executable with two presentation layers over the same core:

```text
sailkari                → TUI (Ink)
sailkari --mcp          → MCP server over stdio

shared application core
  ├─ model lifecycle
  ├─ system prompt management
  ├─ document classification
  ├─ context reuse modes
  ├─ results storage
  └─ evaluation metrics
```

The TUI and MCP adapters both call the same application service; they only differ in how they
render or return the result. This keeps the model logic, evaluation logic, and stored results
consistent regardless of the client interface.

The MCP resource `sailkari://system-prompt-contract` describes the system-prompt format, and
the `generate-system-prompt` MCP prompt helps an agent produce a compatible prompt.

Install from source:

```bash
git clone https://github.com/fasaled/local-ai-classifier.git
cd local-ai-classifier
bun install
bun run build
node dist/index.js
```

## Run an evaluation

Load a model and evaluate the included example corpus:

```text
model models/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf
classify examples/documents examples/labels.yaml --force
```

Use `--force` when repeating a benchmark to run inference again for files that already have a
stored result. Without it, Sailkari displays cached labels and excludes those files from
inference metrics.

## Metrics

For every evaluated document, Sailkari shows the predicted label, total duration, inference
duration, source size, estimated input tokens, model calls, and estimated input throughput.
The final summary groups results into:

- target: model identifier, provider, and applied concurrency;
- file outcomes: labelled, no match, and cached;
- timing: wall-clock elapsed time (with setup), per-file average latency, and aggregate compute time;
- workload: bytes, estimated input tokens, calls, chunks, and effective input tokens per second.

This keeps quality signals and performance signals together while comparing models.

## Concurrency

Sailkari processes document classification in parallel:

- **Cloud models:** Default concurrency is **4** parallel workers with HTTP connection keep-alive.
- **Local GGUF models:** Default concurrency is **1** to prevent GPU memory contention and VRAM exhaustion.
- **Custom concurrency:** Pass `--concurrency <N>` (or `-c <N>`) to override the number of parallel workers for any model:

```bash
classify examples/documents examples/labels.yaml --concurrency 6
```

## Commands

Enter these commands in the lower input panel:

```text
model <path.gguf|dir|name>         Load GGUF, local Kev bundle, or cloud model (e.g. jev)
prompt <path|default>              Configure the system prompt
classify <folder> <labels.yaml>   Classify a folder
classify <folder> <labels.yaml> --force
classify <folder> <labels.yaml> --concurrency <n>
list-tags <folder>                 List stored classifications
remove-tags <folder>               Remove stored classifications
provider set <name> [key] [url] [t] [m] Configure provider key, endpoint, driver type and models
provider add-model <provider> <model>   Associate a model with a provider
provider remove-model <p> <model>       Unassociate a model from a provider
provider get <name>                 Show status and configuration for a provider
provider list                       List all configured/detected providers
provider remove <name>              Remove a configured provider
key set <provider> <key>            Save API key for a provider
key get <provider>                  Show configured API key for provider
key list                            List configured providers
key remove <provider>               Remove API key for provider
cancel                              Cancel the active operation
queue                               List pending commands
queue remove <position>             Remove a pending command
queue move <from> <to>              Reorder pending commands
queue clear                         Remove all pending commands
help                                Show command help
quit                                Exit Sailkari
```

## Cloud Models & Providers

Sailkari supports hybrid benchmarking comparing local GGUF models against any cloud provider and model without hardcoded restrictions:

1. **System One Decision Models:** Such as **TypeSafe Jev** (cloud) or open-weight **Kev** checkpoints running locally (e.g. `kev-0.8b-gguf`), returning structured choices and calibrated probabilities through pointer heads without text generation.
2. **OpenAI-Compatible LLMs:** Any custom proxy, gateway, or provider adhering to the chat completions API (e.g. OpenAI, Groq, OpenRouter, vLLM, Ollama, OpenCode Zen).

Any model can be referenced using the `<provider>:<model>` syntax (e.g., `zen:jev`, `openai:gpt-4o-mini`, `openrouter:anthropic/claude-3.5-sonnet`).

### System Prompts in Cloud Models

- **For generative LLMs (OpenAI-compatible):** The standard Sailkari system prompt (`DEFAULT_SYSTEM_PROMPT` or custom) is passed as `role: "system"` with `temperature: 0`. The strict output contract guarantees clean, single-label responses.
- **For Jev (System One):** Jev evaluates native `choice` questions against criteria. Domain instructions from your configured system prompt are passed into Jev's evaluation instructions, while conversational formatting boilerplate is stripped automatically.

### Configuring Providers & Models in the TUI

Providers and their associated models can be dynamically configured in the TUI and are saved in `~/.config/sailkari/config.json`:

```text
# Configure a provider with custom endpoint, driver type and associated models:
provider set zen --key mi_key --endpoint https://api.zen.opencode.ai/v1 --type jev --models jev,decision-v1

# Or associate models incrementally:
provider add-model zen jev
provider add-model openai gpt-4o-mini

# Inspect and list configured providers and their models:
provider list
provider get zen

# Load and benchmark:
model zen:jev
classify examples/documents examples/labels.yaml --force
```

Legacy `key set <provider> <key>` commands remain fully supported for quick API key configuration.

### Passing Credentials & Models via Environment Variables

For automated runs and MCP server setups (e.g., in Claude Desktop or cursor configuration), providers, keys, endpoints, driver types, and allowed models are configured via 4 standard, predictable environment variables per provider:

```bash
# For any provider <NAME> (e.g., ZEN, OPENAI, TYPESAFE, GROQ):
export ZEN_API_KEY="my_api_key"
export ZEN_BASE_URL="https://api.zen.opencode.ai/v1"
export ZEN_DRIVER_TYPE="jev"                         # "jev" or "openai-compatible" (optional)
export ZEN_MODELS="jev,decision-v1"                  # comma-separated models (optional)
```

Environment variables always take precedence over keys saved in `config.json`. When `list_models` is invoked by an MCP client, it returns all models associated via `<PROVIDER>_MODELS` or configured in the TUI, keeping authorized model choices explicit and secure without exposing secret keys over stdio.

The upper panel displays benchmark tables, summaries, warnings, and errors. Model and system
prompt configuration is saved in `~/.config/sailkari/config.json`. Use Tab for command and
path completion. Operations run in a worker thread, so the TUI remains available while a
model loads or files are classified. New commands are queued and can be inspected, reordered,
or removed with `queue`; use `cancel` to stop the active operation.

Use Up and Down to browse the persistent command history; it is stored with the rest of the
configuration in `~/.config/sailkari/config.json`. Use Shift+Up and Shift+Down to scroll the
activity panel; Page Up and Page Down are also supported.

## Labels

Labels are a YAML map of names to natural-language descriptions:

```yaml
family: "Family documents including personal letters and school documents"
banking: "Banking and financial documents including statements and tax returns"
technology: "Technology documents including architecture and security guides"
```

See `examples/labels.yaml` for a larger example.

## System prompts

Use `prompt default` to use the built-in classifier prompt. To use a custom prompt, run
`prompt examples/system-prompt.txt`.

The parser accepts:

- a bare label name, such as `banking`;
- JSON such as `{"labels":["banking"]}` or `[{"label":"banking"}]`.

The system prompt should request exactly one label and no explanation. Unknown or invalid
output is treated as no match.

## Local execution

The model remains loaded for the TUI session and is released when the application exits.
Contexts follow the selected benchmark mode and are always disposed after their scope ends.
No model or document data is sent over the network; npm may access the network during
installation to fetch dependencies and the platform-specific native prebuilt.

## Packaging

The published Sailkari package contains the compiled JavaScript CLI. `node-llama-cpp` is a
runtime dependency and provides the platform packages for each supported environment, such as
`@node-llama-cpp/mac-arm64-metal`, `@node-llama-cpp/linux-x64`, and
`@node-llama-cpp/win-x64`.

GGUF files are excluded from the package and are provided separately through the `model`
command.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

Run model-dependent tests explicitly:

```bash
CLASSIFIER_MODEL=/absolute/path/to/model.gguf bun run test:e2e
```

Without `CLASSIFIER_MODEL` (and without a GGUF directly in `models/`), the e2e suite is
skipped.

## Contributing

Development happens in the [Sailkari repository](https://github.com/fasaled/local-ai-classifier).
Open an [issue](https://github.com/fasaled/local-ai-classifier/issues) to report a bug, request
a feature, or discuss a proposed change. Contributions are welcome through pull requests.

## Scope

- Plain text formats only: `.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.yml`, `.xml`, `.log`,
  `.conf`, `.config`, `.ini`, `.toml`, and `.properties`.
- Results are stored per evaluated folder in `.sailkari/results.json`.
- Models are not downloaded automatically.
