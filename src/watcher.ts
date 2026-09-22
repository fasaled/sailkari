import { watch, type FSWatcher } from "node:fs";
import { isTextFile } from "./file-scanner.js";

export interface WatchOptions {
  folder: string;
  onFile: (filePath: string) => void | Promise<void>;
  debounceMs?: number;
  cooldownMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_DEBOUNCE_MS = 750;
const DEFAULT_COOLDOWN_MS = 5000;

export async function watchFolder(opts: WatchOptions): Promise<FSWatcher> {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const pending = new Map<string, NodeJS.Timeout>();
  const inProgress = new Set<string>();
  const recentlyProcessed = new Map<string, number>();
  const ready: string[] = [];
  let processing = false;
  let aborted = false;

  async function processNext() {
    if (processing) return;
    processing = true;
    try {
      while (ready.length > 0 && !aborted) {
        const filePath = ready.shift()!;
        if (inProgress.has(filePath)) continue;
        const lastProcessed = recentlyProcessed.get(filePath);
        if (lastProcessed && Date.now() - lastProcessed < cooldownMs) continue;

        inProgress.add(filePath);
        try {
          await opts.onFile(filePath);
        } catch (e) {
          console.error("Error processing", filePath, ":", e instanceof Error ? e.message : e);
        } finally {
          inProgress.delete(filePath);
          recentlyProcessed.set(filePath, Date.now());
        }
      }
    } finally {
      processing = false;
    }
  }

  function scheduleFile(filePath: string) {
    if (aborted) return;
    if (inProgress.has(filePath)) return;
    if (ready.includes(filePath)) return;

    const lastProcessed = recentlyProcessed.get(filePath);
    if (lastProcessed && Date.now() - lastProcessed < cooldownMs) return;

    const existing = pending.get(filePath);
    if (existing) clearTimeout(existing);

    const t = setTimeout(() => {
      pending.delete(filePath);
      if (aborted) return;
      if (!isTextFile(filePath)) return;
      ready.push(filePath);
      processNext();
    }, debounceMs);

    pending.set(filePath, t);
  }

  function handleEvent(eventType: string, filename: string | Buffer | null) {
    if (aborted) return;
    if (!filename) return;
    const name = filename.toString();
    if (name.startsWith(".")) return;
    const fullPath = `${opts.folder}/${name}`.replace(/\/+/g, "/");

    if (eventType === "rename" && name.includes("/")) {
      return;
    }
    scheduleFile(fullPath);
  }

  const watcher = watch(opts.folder, { recursive: false, signal: opts.signal }, (event, name) => {
    handleEvent(event, name);
  });

  watcher.on("error", (e: any) => {
    if (aborted || opts.signal?.aborted || e?.name === "AbortError" || e?.code === "ABORT_ERR") return;
    console.error("Watcher error:", e.message);
  });

  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      aborted = true;
    });
  }

  return watcher;
}
