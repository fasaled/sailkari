# Technical decisions

This document records the architectural and engineering decisions made during the evolution of Sailkari. Each entry details the **Context**, **Decision**, and **Consequences**.

The architectural trajectory follows a coherent progression: transitioning from an initial exploratory Proof of Concept (PoC) into a robust, portable, and extensible tool designed for open-source distribution and practical reuse by other engineers and AI agents.

---

## Evolution roadmap

1. **Phase 1: Proof of Concept & Feasibility (Commits `44da613` – `82e6bb5`)**
   - Validated that small local GGUF models (1.5B–4B) running on consumer hardware could classify text documents into a user-defined taxonomy.
   - Relied on rapid prototyping choices: external `llama-server` binaries and macOS extended filesystem attributes (`xattr`).

2. **Phase 2: Workflow Simplification & Lifecycle Management (Commits `643e183` – `ea05073`)**
   - Removed manual lifecycle friction (abandoning explicit `start`/`stop` daemon management).
   - Added automatic model lifecycle control, document chunking with majority voting, and continuous folder observation (`--watch`) with debouncing and queue deduplication.

3. **Phase 3: Public Release Readiness, Portability & Repositioning (Commits `05d4c2b` – `2d67b4f`)**
   - Purged tracked binaries from Git history and established automated prebuild downloading.
   - Reframed product purpose: positioned from a brittle "production classifier" to a disciplined **PoC benchmarking harness** to compare GGUFs, system prompts, and context behavior.
   - Renamed executable to `sailkari` ("the one who classifies" in Basque) under `@fasaled/sailkari`.

4. **Phase 4: Modern Architecture — Portable Store, TUI, Worker Threads & MCP (Commits `81b0383` – `40b0c63`)**
   - Replaced platform-locked `xattr` with portable `.sailkari/results.json` (`ClassificationStore`).
   - Replaced fragile `llama-server` child processes with in-process `node-llama-cpp` bindings.
   - Introduced a full-screen React/Ink Terminal UI (TUI) powered by an asynchronous worker thread (`operation-worker.ts`) and command queue.
   - Implemented Model Context Protocol (MCP) server over stdio on top of a shared `SailkariApplication` core.
    - Migrated developer tooling to Bun while preserving Node >= 20 distribution compatibility.

---

## D1 — In-process child process `llama-server` for initial PoC

**Context:** The initial goal was to quickly test whether local GGUF models could classify plain text files on macOS using llama.cpp without maintaining heavy C++ compilation pipelines.

**Decision:** Spawn `llama-server` as an external child process listening on a local HTTP port (`http://127.0.0.1:8080/completion`), checking health with curl/fetch and terminating it with POSIX signals.

**Consequences:** Validated the concept quickly with zero native Node addon dependencies. However, managing child process lifecycles led to orphaned server processes, port collisions, and shutdown race conditions when switching models.

---

## D2 — macOS Finder tag integration via `xattr`

**Context:** For the initial personal demo, having classification labels immediately visible as colored tags in the macOS Finder file browser was visually compelling and required no separate database.

**Decision:** Write tags directly to macOS extended attributes (`com.apple.metadata:_kMDItemUserTags` and custom attributes `ai-classified` / `ai-classified-labels`) using native `xattr` system bindings.

**Consequences:** Tied the tool strictly to macOS and file systems supporting extended attributes. It prevented Linux and Windows support, made automated testing in CI difficult, and left no portable artifact of benchmark runs that could be committed or transferred. (Later superseded by D10).

---

## D3 — Document chunking and majority voting for large files

**Context:** Real-world documents (such as architecture guides and technical manuals) frequently exceed small LLM context limits (e.g., 2,048 or 4,096 tokens). Truncating documents caused severe misclassifications when key topics appeared late in the file.

**Decision:** Divide large documents into sliding or non-overlapping text chunks bounded by character/token limits, classify each chunk independently with the LLM, and determine the document's final label through majority voting (falling back to the first non-NONE label on ties).

**Consequences:** High classification accuracy across documents of arbitrary size. Documented in benchmark reports, allowing small models to evaluate large corpora without out-of-memory errors.

---

## D4 — Integrated model lifecycle: eliminating manual `start` and `stop`

**Context:** The early CLI required users to explicitly run `classifier start <model>`, followed by `classifier classify <dir>`, and finally `classifier stop`. Users frequently forgot to stop servers or ran commands without starting them, producing cryptic connection errors.

**Decision:** Remove manual `start` and `stop` commands entirely. Fold model initialization, health verification, and teardown into the execution lifecycle of `classify`.

**Consequences:** Drastically lowered cognitive load and simplified CLI documentation. Guaranteed that background processes were torn down cleanly on exit or SIGINT.

---

## D5 — Continuous folder observation (`--watch`) with deduplication

**Context:** Users wanted to drop new files into an evaluated directory and receive immediate classifications without repeatedly typing CLI commands and waiting for model load overhead.

**Decision:** Introduce a `--watch` / `-w` flag with a 750ms debounce window, per-file cooldowns, serialized processing queue, and `AbortSignal` handling. The loaded model remains warm in memory between file events.

**Consequences:** Fast classification for incoming files. Deduplication prevented half-written file errors during file copies or editor saves.

---

## D6 — Removing tracked binary blobs from Git

**Context:** The initial repository committed 50MB+ compiled `llama-server` binaries and `.dylib` files directly into Git. This bloated the repository, made cloning slow, and prevented multi-architecture packaging.

**Decision:** Delete tracked binary output from version control, add `bin/` to `.gitignore`, implement build-time fetching for precompiled macOS binaries, add GitHub Actions CI for unit tests, and attach the open-source MIT license.

**Consequences:** Repository shrunk to a fraction of its size. The codebase met open-source packaging standards for public release.

---

## D7 — Repositioning from "production classifier" to "benchmark harness"

**Context:** Real-world testing revealed that small quantized models (1.5B–4B) have varying accuracy, throughput, and determinism depending on prompt framing, temperature, and quantization. Marketing Sailkari as an enterprise-grade automated file organizer risked mismatched user expectations.

**Decision:** Explicitly position Sailkari as a **local-first benchmarking harness and proof-of-concept evaluation tool**. Its primary value is allowing developers to compare GGUF models, system prompts, latency, and context reuse against standardized corpora and taxonomies on their own machines.

**Consequences:** Clear, honest product positioning reflected in README, metrics, and documentation. Refocused feature development toward evaluation telemetry (token throughput, latency breakdown, confusion analysis).

---

## D8 — Project branding and scoped npm packaging (`@fasaled/sailkari`)

**Context:** The initial name `classifier` was generic, clashed with existing npm packages and system executables, and lacked identity.

**Decision:** Rename the project to **Sailkari** (Basque for "the one who classifies"), publish under the npm scope `@fasaled/sailkari`, and keep the executable command name `sailkari`.

**Consequences:** Distinct branding, conflict-free npm registry publishing, and clean CLI ergonomics (`npx @fasaled/sailkari` and `sailkari`).

---

## D9 — Replacing OS `xattr` with portable `ClassificationStore` (`.sailkari/results.json`)

**Context:** macOS `xattr` was the single biggest obstacle to publishing a cross-platform tool. Windows and Linux users could not use the tool, and benchmark comparisons could not be versioned or shared.

**Decision:** Completely remove `xattr`. Implement a dedicated, file-based `ClassificationStore` that records classifications, labels, and timestamps in `.sailkari/results.json` inside the target evaluation directory, using atomic writes (temporary file + rename).

**Consequences:** Full cross-platform compatibility across macOS, Linux, and Windows. Results are human-readable, commit-friendly, and persist across machine boundaries.

---

## D10 — In-process inference via `node-llama-cpp`

**Context:** `llama-server` over HTTP required managing ports, network sockets, child process trees, and platform-specific server builds. Terminating child processes cleanly across unexpected crashes remained brittle.

**Decision:** Migrate inference to `node-llama-cpp` (v3). llama.cpp runs directly in-process through native Node bindings utilizing Metal (macOS), CUDA (Linux/Windows), or CPU. Platform binaries are installed transparently via npm platform packages (`@node-llama-cpp/*`).

**Consequences:** Zero external process management. Native performance with zero HTTP IPC overhead. Full programmatic control over context creation, token generation callbacks, and memory disposal.

---

## D11 — Full-screen interactive Terminal UI (TUI) with Ink and React

**Context:** Benchmarking requires repeatedly tweaking prompts, switching models, and testing directories. A one-shot CLI forced reloading multi-gigabyte models into VRAM on every command invocation, wasting 5–15 seconds per run.

**Decision:** Build an interactive terminal application using Ink 7 with `alternateScreen: true`. The model stays loaded in memory across interactions. The interface features a dual-panel layout: a scrollable Activity/Benchmark pane and a Command/Status pane with autocomplete and history.

**Consequences:** Instant interactive turnaround. Clean screen preservation without cluttering terminal scrollback buffers.

---

## D12 — Offloading inference to a dedicated Worker Thread

**Context:** Ink renders at up to 60 fps on Node's main event loop. Model loading and LLM token generation are CPU/GPU-bound tasks. Running inference on the main thread completely froze the TUI, preventing scrolling, typing, or rendering progress updates.

**Decision:** Delegate all model loading, prompt compilation, and document evaluation to a background Node.js `worker_threads` Worker (`operation-worker.ts`). Communication occurs via typed IPC messages, with native llama.cpp logs routed back to the UI.

**Consequences:** The TUI remains 100% interactive at all times. Users can inspect past results, type upcoming commands, or cancel active runs while heavy inference executes in the background.

---

## D13 — Asynchronous Command Queue and persistent history

**Context:** Users in an interactive session often want to batch multiple operations (e.g., load model → set prompt → classify folder A → classify folder B) without waiting for each step to finish before typing the next.

**Decision:** Implement a non-blocking `CommandQueue` and command history. Commands entered while an operation is busy are enqueued. Users can inspect (`queue`), reorder (`queue move`), remove (`queue remove`), or cancel (`cancel`) operations. Command history persists across sessions in `~/.config/sailkari/config.json`.

**Consequences:** Robust, script-like interactive REPL workflow. Operations execute sequentially and deterministically without dropped inputs.

---

## D14 — Single application core with dual presentation: TUI and MCP

**Context:** AI coding agents and automated developer workflows increasingly rely on the Model Context Protocol (MCP) to interact with tools. Building a separate CLI or API for agents would cause business logic and metric calculations to diverge.

**Decision:** Encapsulate all classification, prompt inspection, storage, and evaluation logic into a pure `SailkariApplication` class (`src/application.ts`). Dispatch execution based on flags:
- Default: launches the interactive Ink TUI (`sailkari`).
- `--mcp`: launches a headless MCP stdio server (`sailkari --mcp`).

**Consequences:** Single source of truth. Both human developers and autonomous MCP agents utilize identical classification algorithms, context reuse policies, prompt validation, and benchmark metrics.

---

## D15 — Explicit context reuse benchmark modes

**Context:** In local LLM inference, allocating context memory and re-evaluating prompt token sequences can represent a substantial fraction of overall latency. Evaluating this behavior is critical when benchmarking small models.

**Decision:** Expose three explicit context-reuse policies:
1. `none` (default): completely fresh context created and destroyed per model call (maximum isolation).
2. `--reuse-context-file`: reuse allocated context between chunks of the same document.
3. `--reuse-context-command`: reuse a single context across all files in the batch, clearing conversational history between files.

**Consequences:** Users can scientifically benchmark the speedup of context caching versus memory footprint and potential attention degradation across different GGUF architectures.

---

## D16 — Strict system prompt contract with resilient multi-format response parsing

**Context:** Quantized small models (1.5B–3B) frequently ignore formatting instructions, returning markdown wrappers (e.g. ` ```json `), conversational chatter ("The category is..."), or JSON key-value pairs. Crashing on unexpected formats ruined batch evaluations.

**Decision:** Define a clear system prompt contract (`sailkari://system-prompt-contract`) requiring exactly one label name or `NONE`. Pair this with a multi-strategy parser (`src/parser.ts`) capable of extracting valid labels from raw strings, JSON objects (`{"label": "..."}`), and JSON arrays, cleanly resolving invalid outputs to `NONE`.

**Consequences:** Resilient batch processing that never crashes due to model output formatting anomalies. Transparently surfaces no-matches in benchmark outcome summaries.

---

## D17 — Tooling migration to Bun for development, Node >= 20 for distribution

**Context:** Fast local test cycles and instant TypeScript transpilation improve developer productivity, but end users of published npm packages expect standard Node.js runtime compatibility.

**Decision:** Adopt Bun as the internal toolchain (`bun test`, `bun run build`, `bun.lock`). Bundle with `bun build --target=node --packages=external` to emit clean, sourcemapped JavaScript targeting Node >= 20.

**Consequences:** Sub-second unit test execution and rapid builds during development. End users install and run `@fasaled/sailkari` via standard `npm` or `npx` on Node without needing Bun installed.

---

## D18 — Living documentation maintained in-tree

**Context:** Software architecture, historical trade-offs, and agent coordination guidelines are easily lost if confined to commit logs or chat sessions.

**Decision:** Maintain living documentation in `docs/`:
- `docs/design.md`: current architecture, layers, and contracts.
- `docs/decisions.md`: chronological ADR record documenting the transition from PoC to product.
- `docs/agents.md`: operational guide and constraints for coding agents and contributors.

**Consequences:** Any contributor or agent working on the codebase has full access to the institutional knowledge, constraints, and architecture.
