import type { ProcessingResult } from "./types.js";

export interface EvaluationSummary {
  files: number;
  tagged: number;
  noLabel: number;
  skipped: number;
  evaluated: number;
  totalDurationMs: number;
  preparationMs: number;
  inferenceMs: number;
  sourceBytes: number;
  inputTokensEstimate: number;
  calls: number;
  chunks: number;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1)}s`;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1_000 && unitIndex < units.length - 1) {
    value /= 1_000;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

export function formatFileMetrics(result: ProcessingResult): string {
  const details = [
    `total ${formatDuration(result.durationMs ?? 0)}`,
    `inference ${formatDuration(result.inferenceMs ?? 0)}`,
  ];
  if (result.sourceBytes !== undefined) details.push(formatBytes(result.sourceBytes));
  if (result.inputTokensEstimate !== undefined) details.push(`~${result.inputTokensEstimate} input tok`);
  if (result.calls !== undefined) details.push(`${result.calls} call${result.calls === 1 ? "" : "s"}`);
  if (result.chunks !== undefined) details.push(`${result.chunks} chunk${result.chunks === 1 ? "" : "s"}`);
  return details.join(" | ");
}

const FILE_WIDTH = 24;
const RESULT_WIDTH = 12;
const METRIC_WIDTH = 8;
const CALLS_WIDTH = 5;

function fit(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 3)}...` : value.padEnd(width);
}

function rate(result: ProcessingResult): string {
  if (!result.inferenceMs || !result.inputTokensEstimate) return "-";
  return `${Math.round(result.inputTokensEstimate / (result.inferenceMs / 1_000))}/s`;
}

export function formatEvaluationTableHeader(): string[] {
  const header = [
    fit("FILE", FILE_WIDTH),
    fit("RESULT", RESULT_WIDTH),
    fit("TOTAL", METRIC_WIDTH),
    fit("INFER", METRIC_WIDTH),
    fit("SIZE", METRIC_WIDTH),
    fit("TOKENS", METRIC_WIDTH),
    fit("CALLS", CALLS_WIDTH),
    fit("TOK/S", METRIC_WIDTH),
  ].join(" ");
  return [header, "-".repeat(header.length)];
}

export function formatEvaluationTableRow(filename: string, result: ProcessingResult): string {
  const outcome = result.status === "ok"
    ? result.labels?.join(", ") ?? "labelled"
    : result.status === "none"
      ? "no match"
      : result.labels?.length
        ? `${result.labels.join(", ")} (cached)`
        : `skip: ${result.reason ?? "unknown"}`;
  return [
    fit(filename, FILE_WIDTH),
    fit(outcome, RESULT_WIDTH),
    fit(formatDuration(result.durationMs ?? 0), METRIC_WIDTH),
    fit(result.inferenceMs === undefined ? "-" : formatDuration(result.inferenceMs), METRIC_WIDTH),
    fit(result.sourceBytes === undefined ? "-" : formatBytes(result.sourceBytes), METRIC_WIDTH),
    fit(result.inputTokensEstimate === undefined ? "-" : `~${result.inputTokensEstimate}`, METRIC_WIDTH),
    fit(result.calls === undefined ? "-" : String(result.calls), CALLS_WIDTH),
    fit(rate(result), METRIC_WIDTH),
  ].join(" ");
}

export function summarizeEvaluation(
  results: ProcessingResult[],
  totalDurationMs: number,
  preparationMs: number
): EvaluationSummary {
  const summary: EvaluationSummary = {
    files: results.length,
    tagged: 0,
    noLabel: 0,
    skipped: 0,
    evaluated: 0,
    totalDurationMs,
    preparationMs,
    inferenceMs: 0,
    sourceBytes: 0,
    inputTokensEstimate: 0,
    calls: 0,
    chunks: 0,
  };

  for (const result of results) {
    if (result.status === "ok") summary.tagged++;
    else if (result.status === "none") summary.noLabel++;
    else summary.skipped++;
    if (result.inferenceMs !== undefined) summary.evaluated++;
    summary.inferenceMs += result.inferenceMs ?? 0;
    summary.sourceBytes += result.sourceBytes ?? 0;
    summary.inputTokensEstimate += result.inputTokensEstimate ?? 0;
    summary.calls += result.calls ?? 0;
    summary.chunks += result.chunks ?? 0;
  }
  return summary;
}

export function formatEvaluationSummaryTable(summary: EvaluationSummary): string[] {
  const average = summary.evaluated ? summary.inferenceMs / summary.evaluated : 0;
  const inputRate = summary.inferenceMs ? Math.round(summary.inputTokensEstimate / (summary.inferenceMs / 1_000)) : 0;
  const header = [fit("METRIC", 14), fit("VALUE", 16), "DETAIL"].join(" ");
  return [
    "Benchmark summary",
    header,
    "-".repeat(header.length),
    [fit("Files", 14), fit(String(summary.files), 16), `${summary.tagged} labelled | ${summary.noLabel} no match | ${summary.skipped} skipped`].join(" "),
    [fit("Timing", 14), fit(formatDuration(summary.totalDurationMs), 16), `setup ${formatDuration(summary.preparationMs)} | inference ${formatDuration(summary.inferenceMs)} | mean ${formatDuration(average)}/file`].join(" "),
    [fit("Input", 14), fit(`~${inputRate} tok/s`, 16), `${formatBytes(summary.sourceBytes)} | ~${summary.inputTokensEstimate} tokens | ${summary.calls} calls | ${summary.chunks} chunks`].join(" "),
  ];
}