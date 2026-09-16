import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import TextInput from "ink-text-input";
import { resolve, basename } from "node:path";
import { scanFolder } from "./file-scanner.js";
import { loadLabels, processFile } from "./classifier.js";
import { ClassificationStore } from "./classification-store.js";
import { LLMEngine } from "./llm-engine.js";
import { DEFAULT_SYSTEM_PROMPT, inspectSystemPrompt, loadSystemPrompt } from "./prompt.js";
import { loadConfig, saveConfig, type SailkariConfig } from "./config.js";
import { HELP_TEXT, parseCommand, type Command } from "./command-parser.js";
import { applyCompletion, completeInput } from "./autocomplete.js";

interface EventLine {
  text: string;
  tone?: "error" | "success" | "muted";
}

const COMMAND_PANEL_HEIGHT = 6;
const PANEL_GAP = 1;

export function App(): React.ReactElement {
  const { exit } = useApp();
  const { rows } = useWindowSize();
  const [input, setInput] = useState("");
  const [events, setEvents] = useState<EventLine[]>([
    { text: "Ready. Type `help` to see the available commands.", tone: "muted" },
  ]);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<SailkariConfig>({});
  const [engine, setEngine] = useState(() => new LLMEngine());
  const [prompt, setPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [activityScroll, setActivityScroll] = useState(0);

  const activityHeight = Math.max(1, rows - COMMAND_PANEL_HEIGHT - PANEL_GAP);
  const activityLines = Math.max(1, activityHeight - 4);
  const firstVisibleEvent = Math.max(0, events.length - activityLines - activityScroll);
  const lastVisibleEvent = Math.max(firstVisibleEvent, events.length - activityScroll);

  useEffect(() => {
    void loadConfig().then((loaded) => {
      setConfig(loaded);
      if (loaded.systemPromptPath) {
        void loadSystemPrompt(loaded.systemPromptPath).then(setPrompt).catch(() => undefined);
      }
    });
    return () => { void engine.dispose(); };
  }, [engine]);

  function addEvent(text: string, tone?: EventLine["tone"]): void {
    setEvents((current) => [...current, { text, tone }].slice(-300));
    setActivityScroll(0);
  }

  useInput((_value, key) => {
    if (key.tab && !busy) {
      const nextSuggestions = completeInput(input);
      if (nextSuggestions.length === 0) return;
      const nextIndex = (suggestionIndex + 1) % nextSuggestions.length;
      setSuggestionIndex(nextIndex);
      setInput(applyCompletion(input, nextSuggestions[nextIndex]!));
      setSuggestions(nextSuggestions);
      return;
    }

    if (key.pageUp || (key.upArrow && input.length === 0)) {
      setActivityScroll((current) => Math.min(current + activityLines, Math.max(0, events.length - activityLines)));
    } else if (key.pageDown || (key.downArrow && input.length === 0)) {
      setActivityScroll((current) => Math.max(0, current - activityLines));
    }
  });

  async function execute(command: Command): Promise<void> {
    if (command.type === "quit") {
      await engine.dispose();
      exit();
      return;
    }
    if (command.type === "help") {
      for (const line of HELP_TEXT.split("\n")) addEvent(line, "muted");
      return;
    }
    if (command.type === "model") {
      const modelPath = resolve(command.path);
      setBusy(true);
      addEvent(`Loading model: ${modelPath}`);
      try {
        await engine.dispose();
        const nextEngine = new LLMEngine();
        await nextEngine.loadModel(modelPath);
        setEngine(nextEngine);
        const next = { ...config, modelPath };
        setConfig(next);
        await saveConfig(next);
        addEvent("Model loaded and configuration saved.", "success");
      } catch (error) {
        addEvent(error instanceof Error ? error.message : String(error), "error");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (command.type === "prompt") {
      if (command.path === null) {
        const next = { ...config };
        delete next.systemPromptPath;
        setConfig(next);
        setPrompt(DEFAULT_SYSTEM_PROMPT);
        await saveConfig(next);
        addEvent("Using the default system prompt.", "success");
        return;
      }
      const promptPath = resolve(command.path);
      try {
        const nextPrompt = await loadSystemPrompt(promptPath);
        for (const warning of inspectSystemPrompt(nextPrompt)) addEvent(`Warning: ${warning}`, "muted");
        const next = { ...config, systemPromptPath: promptPath };
        setConfig(next);
        setPrompt(nextPrompt);
        await saveConfig(next);
        addEvent(`System prompt configured: ${promptPath}`, "success");
      } catch (error) {
        addEvent(error instanceof Error ? error.message : String(error), "error");
      }
      return;
    }
    if (command.type === "classify") {
      if (!config.modelPath) {
        addEvent("Configure a model first with: model <path.gguf>", "error");
        return;
      }
      setBusy(true);
      try {
        const labels = await loadLabels(resolve(command.labels));
        const folder = resolve(command.folder);
        const store = new ClassificationStore(folder);
        const files = scanFolder(folder);
        addEvent(`Classifying ${files.length} files in ${folder}`);
        for (const filePath of files) {
          const result = await processFile(filePath, labels, command.force, engine, store, prompt);
          const name = basename(filePath);
          if (result.status === "ok") addEvent(`${name} -> ${result.labels?.join(", ")}`, "success");
          else if (result.status === "none") addEvent(`${name} -> no label found`);
          else addEvent(`${name} -> skipped (${result.reason ?? "already classified"})`, "muted");
        }
        addEvent("Classification complete.", "success");
      } catch (error) {
        addEvent(error instanceof Error ? error.message : String(error), "error");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (command.type === "list-tags" || command.type === "remove-tags") {
      const folder = resolve(command.folder);
      const store = new ClassificationStore(folder);
      if (command.type === "list-tags") {
        for (const entry of store.entries()) addEvent(`${basename(entry.filePath)} -> ${entry.labels.join(", ") || "no label"}`);
        return;
      }
      for (const entry of store.entries()) {
        store.remove(entry.filePath);
        addEvent(`${basename(entry.filePath)} -> removed`, "success");
      }
    }
  }

  async function submit(value: string): Promise<void> {
    setInput("");
    setSuggestions([]);
    setSuggestionIndex(0);
    if (busy) return;
    try {
      await execute(parseCommand(value));
    } catch (error) {
      addEvent(error instanceof Error ? error.message : String(error), "error");
    }
  }

  return (
    <Box flexDirection="column" height={rows} paddingX={1}>
      <Box flexDirection="column" height={activityHeight} overflow="hidden" borderStyle="round" borderColor="gray" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">SAILKARI</Text>
          <Text dimColor>activity {activityScroll > 0 ? `(page ${Math.ceil(activityScroll / activityLines)})` : "(latest)"}</Text>
        </Box>
        <Text dimColor>────────────────────────────────────────────────────────</Text>
        {events.slice(firstVisibleEvent, lastVisibleEvent).map((event, index) => (
          <Text key={`${firstVisibleEvent + index}-${event.text}`} color={event.tone === "error" ? "red" : event.tone === "success" ? "green" : event.tone === "muted" ? "gray" : undefined}>
            {event.tone === "error" ? "! " : event.tone === "success" ? "✓ " : "  "}{event.text}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" height={COMMAND_PANEL_HEIGHT} borderStyle="round" borderColor="cyan" paddingX={1} marginTop={PANEL_GAP}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">COMMAND</Text>
          <Text dimColor>{busy ? "working..." : "Enter run  Tab complete"}</Text>
        </Box>
        <Text color="gray" wrap="truncate-end">{suggestions.length > 0 ? suggestions.join("  ") : " "}</Text>
        <Text dimColor wrap="truncate-end">model: {config.modelPath ?? "not configured"} | prompt: {config.systemPromptPath ?? "default"}</Text>
        <Box>
          <Text color="cyan">❯ </Text>
          <TextInput
            value={input}
            onChange={(value) => {
              setInput(value);
              setSuggestions(completeInput(value));
              setSuggestionIndex(0);
            }}
            onSubmit={submit}
          />
        </Box>
      </Box>
    </Box>
  );
}
