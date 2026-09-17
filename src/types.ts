export interface Label {
  name: string;
  description: string;
}

export interface LabelsFile {
  [key: string]: string;
}

export interface ClassificationResult {
  labels: string[];
}

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  created: Date;
  modified: Date;
  existingTags: string[];
}

export interface FileMetadata {
  info: FileInfo;
  content: string;
  tokenCount: number;
}

export interface ProcessingResult {
  status: "ok" | "none" | "skip";
  filePath: string;
  labels?: string[];
  chunks?: number;
  calls?: number;
  reason?: string;
  durationMs?: number;
  inferenceMs?: number;
  sourceBytes?: number;
  inputTokensEstimate?: number;
}

export interface ProcessingSummary {
  processed: number;
  tagged: number;
  noLabel: number;
  skipped: number;
  totalTime: number;
}