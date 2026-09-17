import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import TextInput from "ink-text-input";
import { Worker } from "node:worker_threads";
import { DEFAULT_SYSTEM_PROMPT } from "./prompt.js";
import { loadConfig, saveConfig, type SailkariConfig } from "./config.js";
import { HELP_TEXT, parseCommand, type Command } from "./command-parser.js";
import { applyCompletion, completeInput } from "./autocomplete.js";
import { CommandQueue, type QueuedCommand, type RunnableCommand } from "./command-queue.js";
import { CommandHistory } from "./command-history.js";

interface EventLine {
  id: number;
  text: string;
  tone?: "error" | "success" | "warning" | "muted";
}

const COMMAND_PANEL_HEIGHT = 9;
const PANEL_GAP = 1;

export function App(): React.ReactElement {
  const { exit } = useApp();
  const { rows } = useWindowSize();
  const [input, setInput] = useState("");
  const [events, setEvents] = useState<EventLine[]>([
    { id: 0, text: "Ready. Type `help` to see the available commands.", tone: "muted" },
  ]);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<SailkariConfig>({});
  const [prompt, setPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [inputVersion, setInputVersion] = useState(0);
  const [activityScroll, setActivityScroll] = useState(0);
  const [queue, setQueue] = useState<readonly QueuedCommand[]>([]);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const commandQueueRef = useRef(new CommandQueue());
  const activeCommandRef = useRef<QueuedCommand | null>(null);
  const commandHistoryRef = useRef(new CommandHistory());
  const nextEventIdRef = useRef(1);

  const activityHeight = Math.max(1, rows - COMMAND_PANEL_HEIGHT - PANEL_GAP);
  const activityLines = Math.max(1, activityHeight - 4);
  const firstVisibleEvent = Math.max(0, events.length - activityLines - activityScroll);
  const lastVisibleEvent = Math.max(firstVisibleEvent, events.length - activityScroll);

  useEffect(() => {
    const worker = new Worker(new URL("./operation-worker.js", import.meta.url));
    workerRef.current = worker;
    worker.on("message", (message: { type: string; id: number; text?: string; tone?: EventLine["tone"]; level?: string; modelPath?: string; prompt?: string; systemPromptPath?: string | null; warnings?: string[] }) => {
      if (message.type === "event") addEvent(message.text!, message.tone);
      if (message.type === "native-log") addEvent(`[llama.cpp] ${message.text!}`, message.level === "error" || message.level === "fatal" ? "error" : "warning");
      if (message.type === "model-loaded") {
        setConfig((current) => {
          const next = { ...current, modelPath: message.modelPath! };
          void saveConfig(next);
          return next;
        });
        addEvent("Model loaded and configuration saved.", "success");
      }
      if (message.type === "prompt-loaded") {
        for (const warning of message.warnings ?? []) addEvent(`Warning: ${warning}`, "muted");
        setPrompt(message.prompt!);
        setConfig((current) => {
          const next = { ...current };
          if (message.systemPromptPath) next.systemPromptPath = message.systemPromptPath;
          else delete next.systemPromptPath;
          void saveConfig(next);
          return next;
        });
        addEvent(message.systemPromptPath ? `System prompt configured: ${message.systemPromptPath}` : "Using the default system prompt.", "success");
      }
      if (message.type === "error" || message.type === "cancelled" || message.type === "done") {
        if (message.type === "error") addEvent(message.text!, "error");
        if (message.type === "cancelled") addEvent("Operation cancelled.", "muted");
        finishActiveCommand(message.id);
      }
    });
    void loadConfig().then((loaded) => {
      setConfig(loaded);
      commandHistoryRef.current.load(loaded.commandHistory ?? []);
      if (loaded.modelPath) commandQueueRef.current.enqueue(`model ${loaded.modelPath}`, { type: "model", path: loaded.modelPath });
      if (loaded.systemPromptPath) commandQueueRef.current.enqueue(`prompt ${loaded.systemPromptPath}`, { type: "prompt", path: loaded.systemPromptPath });
      refreshQueue();
      void runNextCommand();
    });
    return () => { void worker.terminate(); };
  }, []);

  function addEvent(text: string, tone?: EventLine["tone"]): void {
    const event = { id: nextEventIdRef.current++, text, tone };
    setEvents((current) => [...current, event].slice(-300));
    setActivityScroll(0);
  }

  useInput((_value, key) => {
    if (key.tab && !busy) {
      const nextSuggestions = suggestions.length > 0 ? suggestions : completeInput(input);
      if (nextSuggestions.length === 0) return;
      const completion = applyCompletion(input, nextSuggestions[suggestionIndex]!);
      setInput(completion);
      setInputVersion((current) => current + 1);
      setSuggestionIndex((suggestionIndex + 1) % nextSuggestions.length);
      setSuggestions(nextSuggestions);
      return;
    }

    if (key.shift && key.upArrow) {
      setActivityScroll((current) => Math.min(current + activityLines, Math.max(0, events.length - activityLines)));
      return;
    }

    if (key.shift && key.downArrow) {
      setActivityScroll((current) => Math.max(0, current - activityLines));
      return;
    }

    if (key.upArrow) {
      const previous = commandHistoryRef.current.previous(input);
      if (previous !== undefined) {
        setInput(previous);
        setInputVersion((current) => current + 1);
        setSuggestions(completeInput(previous));
        setSuggestionIndex(0);
      }
      return;
    }

    if (key.downArrow) {
      const next = commandHistoryRef.current.next();
      if (next !== undefined) {
        setInput(next);
        setInputVersion((current) => current + 1);
        setSuggestions(completeInput(next));
        setSuggestionIndex(0);
      }
      return;
    }

    if (key.pageUp) {
      setActivityScroll((current) => Math.min(current + activityLines, Math.max(0, events.length - activityLines)));
    } else if (key.pageDown) {
      setActivityScroll((current) => Math.max(0, current - activityLines));
    }
  });

  function refreshQueue(): void {
    setQueue([...commandQueueRef.current.entries()]);
  }

  function finishActiveCommand(id: number): void {
    if (activeCommandRef.current?.id !== id) return;
    const completed = activeCommandRef.current;
    activeCommandRef.current = null;
    setBusy(false);
    setActiveTask(null);
    if (completed.command.type === "quit") {
      exit();
      return;
    }
    void runNextCommand();
  }

  async function runNextCommand(): Promise<void> {
    if (activeCommandRef.current) return;
    const next = commandQueueRef.current.dequeue();
    refreshQueue();
    if (!next) return;

    activeCommandRef.current = next;
    setBusy(true);
    setActiveTask(`running: ${next.input}`);
    const { command } = next;
    if (command.type === "help") {
      for (const line of HELP_TEXT.split("\n")) addEvent(line, "muted");
      finishActiveCommand(next.id);
      return;
    }
    if (command.type === "quit") {
      finishActiveCommand(next.id);
      return;
    }
    workerRef.current?.postMessage({ type: "run", id: next.id, command, systemPrompt: prompt });
  }

  function submit(value: string): void {
    setInput("");
    setSuggestions([]);
    setSuggestionIndex(0);
    commandHistoryRef.current.record(value);
    setConfig((current) => {
      const next = { ...current, commandHistory: [...commandHistoryRef.current.all()] };
      void saveConfig(next);
      return next;
    });
    try {
      const command = parseCommand(value);
      if (command.type === "cancel") {
        const active = activeCommandRef.current;
        if (active) workerRef.current?.postMessage({ type: "cancel", id: active.id });
        else addEvent("No active operation to cancel.", "muted");
      } else if (command.type === "queue") {
        if (command.action === "show") {
          const entries = commandQueueRef.current.entries();
          addEvent(entries.length ? entries.map((entry, index) => `${index + 1}. ${entry.input}`).join(" | ") : "Queue is empty.", "muted");
        } else if (command.action === "clear") {
          addEvent(`Removed ${commandQueueRef.current.clear()} queued command(s).`, "muted");
          refreshQueue();
        } else if (command.action === "remove") {
          const removed = commandQueueRef.current.remove(command.position!);
          addEvent(removed ? `Removed: ${removed.input}` : "No queued command at that position.", "muted");
          refreshQueue();
        } else {
          const moved = commandQueueRef.current.move(command.position!, command.destination!);
          addEvent(moved ? "Queue reordered." : "Invalid queue positions.", "muted");
          refreshQueue();
        }
      } else {
        commandQueueRef.current.enqueue(value, command as RunnableCommand);
        refreshQueue();
        void runNextCommand();
      }
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
        {events.slice(firstVisibleEvent, lastVisibleEvent).map((event, index) => (
          <Text key={event.id} color={event.tone === "error" ? "red" : event.tone === "success" ? "green" : event.tone === "warning" ? "yellow" : event.tone === "muted" ? "gray" : undefined}>
            {event.tone === "error" ? "! " : event.tone === "success" ? "✓ " : "  "}{event.text}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" height={COMMAND_PANEL_HEIGHT} borderStyle="round" borderColor="cyan" paddingX={1} marginTop={PANEL_GAP}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">COMMAND</Text>
          <Text dimColor>{busy ? "working...  cancel stop" : "Enter run  Tab complete  Up/Down history"}</Text>
        </Box>
        <Text color="gray" wrap="truncate-end">{suggestions.length > 0 ? suggestions.join("  ") : " "}</Text>
        <Text dimColor wrap="truncate-end">cwd: {process.cwd()}</Text>
        <Text dimColor wrap="truncate-end">model: {config.modelPath ?? "not configured"} | prompt: {config.systemPromptPath ?? "default"}</Text>
        <Text dimColor wrap="truncate-end">active: {activeTask ?? "idle"}</Text>
        <Text color="yellow" wrap="truncate-end">queue: {queue.length ? queue.map((entry, index) => `${index + 1}. ${entry.input}`).join(" | ") : "empty"}</Text>
        <Box>
          <Text color="cyan">❯ </Text>
          <TextInput
            key={inputVersion}
            value={input}
            onChange={(value) => {
              setInput(value);
              commandHistoryRef.current.reset();
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
