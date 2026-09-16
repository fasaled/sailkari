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

File classification works anywhere the native addon runs. Writing and listing Sailkari's
extended-attribute tags currently requires the macOS `xattr` command.

## Install and run

Run without a global installation:

```bash
npx sailkari classify \
  --folder ./documents \
  --labels ./labels.yaml \
  --model ./models/model.gguf
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
node dist/index.js help
```

## Usage

```text
sailkari classify --folder <path> --labels <yaml> --model <gguf> [options]
```

| Option | Description |
|---|---|
| `--folder`, `-f` | Folder to process (required) |
| `--labels`, `-l` | YAML label file (required) |
| `--model`, `-m` | Path to an external GGUF model (required) |
| `--system-prompt`, `-s` | Optional system prompt file |
| `--force` | Reclassify files that already have Sailkari's marker |
| `--watch`, `-w` | Keep the model loaded and classify changed top-level files |
| `--help`, `-h` | Show command help |

Other commands:

```bash
sailkari list-tags ./documents
sailkari remove-tags ./documents
```

## Labels

Labels are a YAML map of names to natural-language descriptions:

```yaml
family: "Family documents including personal letters and school documents"
banking: "Banking and financial documents including statements and tax returns"
technology: "Technology documents including architecture and security guides"
```

See `examples/labels.yaml` for a larger example.

## System prompts

Omit `--system-prompt` to use the built-in classifier prompt. To compare prompt variants,
copy `examples/system-prompt.txt`, edit it, and pass its path.

The parser accepts:

- a bare label name, such as `banking`;
- JSON such as `{"labels":["banking"]}` or `[{"label":"banking"}]`.

The system prompt should request exactly one label and no explanation. Unknown or invalid
output is treated as no match.

## Lifecycle and privacy

Each completion gets a fresh llama.cpp context. The context is disposed immediately after
generation; the model remains loaded only for the duration of the command (or while
`--watch` is active) and is then disposed explicitly. Repeated classifications therefore do
not retain conversation state or leak contexts.

The execution flow is:

```text
load native addon and GGUF
  → scan files
  → skip files already marked
  → create context
  → generate one classification in-process
  → dispose context
  → parse and write the label
  → dispose model and native runtime
```

No model or document data is sent over the network. npm may use the network during
installation to retrieve Sailkari's dependencies and the platform-specific native prebuilt.

## Packaging

The published Sailkari package contains the compiled JavaScript CLI. `node-llama-cpp` is a
normal runtime dependency and provides platform packages such as
`@node-llama-cpp/mac-arm64-metal`, `@node-llama-cpp/linux-x64`, and
`@node-llama-cpp/win-x64`. npm installs only compatible optional dependencies.

GGUF files are excluded from the package and must be supplied via `--model`.

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
- Extended-attribute tagging currently targets macOS.
- `--watch` watches only the top-level folder.
- Models are not downloaded automatically.
