import { describe, expect, test } from "bun:test";
import { formatBytes, formatEvaluationSummaryTable, formatEvaluationTableHeader, formatEvaluationTableRow, formatFileMetrics, summarizeEvaluation } from "./evaluation-metrics.js";

describe("evaluation metrics", () => {
  test("formats per-file metrics and aggregate benchmark results", () => {
    const results = [
      { status: "ok" as const, filePath: "a.txt", durationMs: 1_200, inferenceMs: 1_000, sourceBytes: 2_048, inputTokensEstimate: 500, calls: 1, chunks: 1 },
      { status: "none" as const, filePath: "b.txt", durationMs: 2_300, inferenceMs: 2_000, sourceBytes: 1_024, inputTokensEstimate: 1_000, calls: 2, chunks: 2 },
      { status: "skip" as const, filePath: "c.txt", reason: "already classified", durationMs: 5 },
    ];

    expect(formatFileMetrics(results[0]!)).toContain("inference 1.00s");
    expect(formatEvaluationSummaryTable(summarizeEvaluation(results, 4_000, 500))).toEqual([
      "Benchmark summary",
      "METRIC         VALUE            DETAIL",
      "--------------------------------------",
      "Files          3                1 labelled | 1 no match | 1 skipped",
      "Timing         4.00s            setup 500ms | inference 3.00s | mean 1.50s/file",
      "Input          ~500 tok/s       3.1 KB | ~1500 tokens | 3 calls | 3 chunks",
    ]);
  });

  test("scales byte values through gigabytes", () => {
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1_500)).toBe("1.5 KB");
    expect(formatBytes(1_500_000)).toBe("1.5 MB");
    expect(formatBytes(1_500_000_000)).toBe("1.5 GB");
  });

  test("formats fixed-width table rows for the TUI", () => {
    const result = { status: "ok" as const, filePath: "report.txt", labels: ["banking"], durationMs: 1_200, inferenceMs: 1_000, sourceBytes: 1_500, inputTokensEstimate: 500, calls: 1 };

    expect(formatEvaluationTableHeader()[0]).toContain("FILE");
    expect(formatEvaluationTableRow("report.txt", result)).toContain("banking");
    expect(formatEvaluationTableRow("report.txt", result)).toContain("500/s");
  });

  test("shows stored labels for cached classification results", () => {
    const result = { status: "skip" as const, filePath: "report.txt", labels: ["banking"], reason: "already classified" };

    expect(formatEvaluationTableRow("report.txt", result)).toContain("banking");
    expect(formatEvaluationTableRow("report.txt", result)).toContain("-");
  });
});