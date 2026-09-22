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

- `load_model`: load a GGUF model from disk
- `set_system_prompt`: set the classifier system prompt
- `classify_documents`: classify a folder using a YAML taxonomy and benchmark settings
- `list_classifications`: inspect stored labels for a folder
- `remove_classifications`: clear stored labels for a folder

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

- file outcomes: labelled, no match, and cached;
- timing: setup, total inference, and mean inference time per evaluated file;
- workload: bytes, estimated input tokens, calls, chunks, and input tokens per second.

This keeps quality signals and performance signals together while comparing models.

## Context modes

The default mode creates a fresh inference context for every model call, maximizing isolation.
Two optional modes measure the effect of reusing allocated context memory without sharing
inference history:

- `--reuse-context-file`: reuse a context between chunks of the same file, then dispose it.
- `--reuse-context-command`: reuse one context across the full `classify` command.

In both modes, Sailkari clears context history between chunks and documents before the next
inference request.

## Commands

Enter these commands in the lower input panel:

```text
model <path.gguf>                  Load and persist the inference model
prompt <path|default>              Configure the system prompt
classify <folder> <labels.yaml>   Classify a folder
classify <folder> <labels.yaml> --force
classify <folder> <labels.yaml> --reuse-context-file
classify <folder> <labels.yaml> --reuse-context-command
list-tags <folder>                 List stored classifications
remove-tags <folder>               Remove stored classifications
cancel                              Cancel the active operation
queue                               List pending commands
queue remove <position>             Remove a pending command
queue move <from> <to>              Reorder pending commands
queue clear                         Remove all pending commands
help                               Show command help
quit                               Exit Sailkari
```

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
