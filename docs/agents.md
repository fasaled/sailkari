# agents.md — sailkari

Local-first GGUF document classifier and benchmarking harness. Single executable with dual presentation: interactive terminal UI (Ink/React) and Model Context Protocol (MCP) server over stdio.

## Commands

| Action | Command |
|---|---|
| Install dependencies | `bun install` |
| Test suite | `bun test` |
| Test single file | `bun test src/classifier.test.ts` |
| Typecheck | `bun run typecheck` (`tsc -p tsconfig.json`) |
| Build bundle | `bun run build` → `dist/` |
| Run TUI (from dist) | `node dist/index.js` (or `bun run start`) |
| Run MCP server | `node dist/index.js --mcp` |
| E2E inference test | `CLASSIFIER_MODEL=/path/to/model.gguf bun run test:e2e` |

Always verify changes with:
```bash
bun run typecheck && bun test && bun run build
```

## Runtime and Packaging

- **Bun** is the development runtime and package manager (`bun install`, `bun test`, `bun run build`).
- **Node >= 20** is the distribution runtime. Published package has `engines: { "node": ">=20.0.0" }`.
- Build emits to `dist/` (`bun build ... --target=node --packages=external --splitting`).
- **`node-llama-cpp`** (v3) provides native bindings (Metal/CUDA/CPU) via platform-specific npm packages (`@node-llama-cpp/*`). Never invoke external `llama-server` or compile C++ manually.
- **Local-first with hybrid cloud benchmarking**: Local GGUF evaluation remains strictly offline with zero external network requests. Cloud decision models (such as TypeSafe Jev) make HTTPS calls to their official API only when explicitly selected by the user or agent.

## Architecture

```text
src/index.tsx (CLI entry router)
  ├── --mcp       → src/mcp.ts (MCP stdio server)
  └── [default]   → src/tui.tsx (Ink alternate-screen TUI)
                      └── (Worker Thread) → src/operation-worker.ts
                                              └── src/application.ts (SailkariApplication core)
                                                    ├── src/llm-engine.ts (node-llama-cpp & cloud drivers)
                                                    ├── src/jev-driver.ts (TypeSafe Jev System One)
                                                    ├── src/api-keys.ts (credential resolution & catalog)
                                                    ├── src/classifier.ts (chunking + voting)
                                                    └── src/classification-store.ts (.sailkari/results.json)
```

- **UI thread isolation:** Ink renders at 60 fps on the main thread (`alternateScreen: true`). Model loading, LLM inference, and file walks **must run on the worker thread** (`src/operation-worker.ts`). Never run inference on the main thread.
- **Shared application core:** `SailkariApplication` (`src/application.ts`) owns model lifecycle, prompt inspection, file scanning, and classification. Both TUI and MCP delegate to it.
- **IPC Protocol:** Main thread and worker communicate via typed messages (`RunMessage`, progress, native logs, abort signals via `AbortController`).
- **Persistence:**
  - Per-folder classification results: `.sailkari/results.json` via `ClassificationStore` (atomic write via temp file + rename).
  - Global user settings and command history: `~/.config/sailkari/config.json`.

## Where code goes

| Area | Path | Responsibility |
|---|---|---|
| CLI Router | `src/index.tsx` | Routes `--mcp` vs interactive TUI |
| Terminal UI | `src/tui.tsx` | Ink 7 app, panels, scroll, keyboard shortcuts |
| Operation Worker | `src/operation-worker.ts` | Worker thread executing compute-heavy tasks |
| MCP Server | `src/mcp.ts` | Tools (`load_model`, `classify_documents`, etc.), prompt template, contract resource |
| Application Core | `src/application.ts` | High-level operations (`loadModel`, `evaluate`, `listClassifications`) |
| LLM Driver | `src/llm-engine.ts` | `node-llama-cpp` adapter, context lifecycle, context-reuse scopes |
| Jev Cloud Driver | `src/jev-driver.ts` | TypeSafe Jev System One decision model integration via native `fetch` |
| OpenAI Cloud Driver | `src/openai-driver.ts` | OpenAI-compatible (/v1/chat/completions) cloud model integration |
| API Keys & Catalog | `src/api-keys.ts` | Credential resolution (env & config), key masking, and cloud models catalog |
| Classifier Pipeline | `src/classifier.ts` | Chunking large files, majority voting, caching bypass with `--force` |
| Classification Store | `src/classification-store.ts` | Local `.sailkari/results.json` reader/writer |
| File Scanner | `src/file-scanner.ts` | Recursive plain-text file scanner |
| Command Parser | `src/command-parser.ts` | Parses and validates user input strings into typed `Command` objects |
| Autocomplete | `src/autocomplete.ts` | Tab-completion for commands, paths, and flags |
| Command Queue | `src/command-queue.ts` | Asynchronous queue with move, remove, and clear operations |
| Command History | `src/command-history.ts` | Persistent command history across sessions |
| Metrics | `src/evaluation-metrics.ts` | Latency, throughput (tokens/sec), and summary table formatting |
| Prompts | `src/prompt.ts` | Default system prompt, taxonomy formatting, and output contract |
| Output Parser | `src/parser.ts` | Multi-strategy extraction: bare text, JSON object, JSON array |
| Types | `src/types.ts` | Shared TypeScript interfaces |

## Adding a command

1. **Parser:** Add the command type and syntax parsing in `src/command-parser.ts` + tests in `src/command-parser.test.ts`.
2. **Core:** Implement the operation on `SailkariApplication` in `src/application.ts`.
3. **Worker:** Handle the command in `src/operation-worker.ts` with typed IPC messages and `AbortSignal` checks.
4. **Autocomplete:** Add completions in `src/autocomplete.ts` + tests in `src/autocomplete.test.ts`.
5. **MCP:** If relevant to external agents, expose the tool or resource in `src/mcp.ts` + tests in `src/mcp.test.ts`.
6. **Documentation:** Update `README.md`, `docs/design.md`, and the command help text in `src/command-parser.ts`.

## Hard constraints (Do not)

- **Do not** spawn child processes for `llama-server`. Use `node-llama-cpp`.
- **Do not** use OS extended attributes (`xattr`). Use `ClassificationStore`.
- **Do not** run model loading or token generation on the main UI thread.
- **Do not** start TUI and MCP concurrently in the same process.
- **Do not** commit GGUF models, binaries, `.tgz` tarballs, or `.DS_Store` files.
- **Do not** make network requests during local GGUF classification or evaluation.
- **Do not** expose API keys, secrets, or credential modification tools over MCP.
- **Do not** use `eval` or execute arbitrary strings as code.

## Conventions

- **Language:** English only for code, comments, commit messages, tests, and TUI labels.
- **Comments:** Explain non-obvious constraints, architectural invariants, or hardware nuances. Never describe trivial operations.
- **Testing:** Unit tests live alongside source code (`src/*.test.ts`). E2E inference tests live in `e2e/`.

## Documentation index

- `README.md` — user installation, usage, commands, and options.
- `docs/design.md` — living architecture spec, concurrency model, and data flow.
- `docs/decisions.md` — technical decisions log (ADRs) explaining the evolution from PoC to product.
- `docs/agents.md` — this operational guide for coding agents.
