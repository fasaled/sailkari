import type { ProcessingResult } from "./types.js";
import { finishProgress } from "./progress.js";

export function formatTimestamp(startTime: Date): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - startTime.getTime()) / 1000);
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function logProgress(
  result: ProcessingResult,
  startTime: Date,
  _labels: Label[] = []
): void {
  const timestamp = formatTimestamp(startTime);
  const filename = result.filePath.split("/").pop() || result.filePath;
  const paddedFilename = filename.padEnd(28).slice(0, 28);

  let line = "";
  if (result.status === "skip") {
    line = `[${timestamp}] SKIP   ${paddedFilename} → already classified`;
  } else if (result.status === "ok") {
    let extra = "";
    if (result.chunks && result.calls) {
      extra = `  (chunks: ${result.chunks}, calls: ${result.calls})`;
    }
    const labelStr = result.labels?.join(", ") || "";
    line = `[${timestamp}] OK     ${paddedFilename} → ${labelStr}${extra}`;
  } else if (result.status === "none") {
    line = `[${timestamp}] NONE   ${paddedFilename} → no label found`;
  }

  finishProgress(line);
}

export function logSummary(summary: {
  processed: number;
  tagged: number;
  noLabel: number;
  skipped: number;
  totalTime: number;
}): void {
  const totalTimeStr = formatDuration(summary.totalTime);
  console.log("──────────────────────────────────────────");
  console.log(`Processed:             ${summary.processed} files`);
  console.log(`  Tagged:              ${summary.tagged}`);
  console.log(`  No label:            ${summary.noLabel}  (no matching label)`);
  console.log(`Skipped:               ${summary.skipped}  (already classified)`);
  console.log(`Total time:            ${totalTimeStr}`);
  console.log("──────────────────────────────────────────");
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

interface Label {
  name: string;
  description: string;
}
