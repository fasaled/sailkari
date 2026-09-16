# Sailkari

**Sailkari** (Basque for “the one who classifies”) classifies local text files with a
user-provided GGUF model. Inference runs in-process through
[`node-llama-cpp`](https://github.com/withcatai/node-llama-cpp); no local server, HTTP port,
external executable, Bun runtime, or cloud API is used.

The model is deliberately not bundled. Bring any instruction-tuned GGUF supported by
llama.cpp. File contents remain local.

## Requirements

- Node.js 20 or newer
- An instruction-tuned GGUF model downloaded separately

The npm installation includes the llama.cpp native addon and libraries for the current
platform. npm selects the appropriate prebuilt package for macOS, Linux, or Windows and for
the current architecture. Sailkari disables source-build fallback: no compiler is required,
and an unsupported platform fails explicitly instead of downloading source code at runtime.

File classification works anywhere the native addon runs. Results are stored portably in
`.sailkari/results.json` inside each classified folder, so the same workflow works on macOS,
Linux, and Windows.

## Install and run

Run the full-screen terminal interface without a global installation:

```bash
npx sailkari
```

Or install globally:

```bash
npm install --global sailkari
sailkari help
```

Install from source:

```bash
git clone https://github.com/fasaled/local-ai-classifier.git
cd local-ai-classifier
npm install
npm run build
node dist/index.js
```

## TUI Commands

Enter these commands in the lower input panel:

```text
model <path.gguf>                  Load and persist the inference model
prompt <path|default>              Configure the system prompt
classify <folder> <labels.yaml>   Classify a folder
classify <folder> <labels.yaml> --force
list-tags <folder>                 List stored classifications
remove-tags <folder>               Remove stored classifications
help                               Show command help
quit                               Exit Sailkari
```

The upper panel keeps results and configuration events in arrival order. The model and
system prompt configuration is saved in `~/.config/sailkari/config.json`. Use Tab for
command and path completion.

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

## Lifecycle and privacy

Each completion gets a fresh llama.cpp context. The context is disposed immediately after
generation; the model remains loaded for the TUI session and is disposed explicitly when
the application exits. Repeated classifications therefore do
not retain conversation state or leak contexts.

The execution flow is:

```text
start the TUI
  → load native addon and GGUF with `model`
  → scan files
  → skip files already stored in `.sailkari/results.json`
  → create context
  → generate one classification in-process
  → dispose context
  → parse and write the label
  → dispose model and native runtime on exit
```

No model or document data is sent over the network. npm may use the network during
installation to retrieve Sailkari's dependencies and the platform-specific native prebuilt.

## Packaging

The published Sailkari package contains the compiled JavaScript CLI. `node-llama-cpp` is a
normal runtime dependency and provides platform packages such as
`@node-llama-cpp/mac-arm64-metal`, `@node-llama-cpp/linux-x64`, and
`@node-llama-cpp/win-x64`. npm installs only compatible optional dependencies.

GGUF files are excluded from the package and must be supplied with the `model` command.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Run model-dependent tests explicitly:

```bash
CLASSIFIER_MODEL=/absolute/path/to/model.gguf npm run test:e2e
```

Without `CLASSIFIER_MODEL` (and without a GGUF directly in `models/`), the e2e suite is
skipped.

## Limitations

- Plain text formats only: `.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.yml`, `.xml`, `.log`,
  `.conf`, `.config`, `.ini`, `.toml`, and `.properties`.
- Results are stored per classified folder in `.sailkari/results.json`.
- Models are not downloaded automatically.
