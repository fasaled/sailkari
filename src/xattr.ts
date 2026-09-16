import { spawnSync } from "node:child_process";

const AI_CLASSIFIED_TAG = "ai-classified";
const AI_CLASSIFIED_LABELS_TAG = "ai-classified-labels";

export function hasAIClassifiedTag(filePath: string): boolean {
  try {
    const output = spawnSync("xattr", ["-l", filePath]).stdout.toString();
    return output.includes(AI_CLASSIFIED_TAG);
  } catch {
    return false;
  }
}

export function getOwnLabels(filePath: string): string[] {
  try {
    const output = spawnSync("xattr", ["-p", AI_CLASSIFIED_LABELS_TAG, filePath]).stdout.toString();
    const labels = output.trim();
    if (!labels) return [];
    return labels.split(" ");
  } catch {
    return [];
  }
}

export function getAllTags(filePath: string): string[] {
  const tags: string[] = [];
  
  // Get our own labels
  const ownLabels = getOwnLabels(filePath);
  if (ownLabels.length > 0) {
    tags.push(...ownLabels);
  }
  
  // Check if has ai-classified marker
  if (hasAIClassifiedTag(filePath)) {
    if (!tags.includes(AI_CLASSIFIED_TAG)) {
      tags.push(AI_CLASSIFIED_TAG);
    }
  }
  
  return tags;
}

export function writeOwnTags(filePath: string, labels: string[]): void {
  spawnSync("xattr", ["-w", AI_CLASSIFIED_TAG, "1", filePath]);
  if (labels.length > 0) {
    spawnSync("xattr", ["-w", AI_CLASSIFIED_LABELS_TAG, labels.join(" "), filePath]);
  }
}

export function removeOwnSemanticTags(filePath: string): void {
  try {
    spawnSync("xattr", ["-d", AI_CLASSIFIED_LABELS_TAG, filePath]);
  } catch {}
}

export function removeOwnTags(filePath: string): void {
  try {
    spawnSync("xattr", ["-d", AI_CLASSIFIED_LABELS_TAG, filePath]);
  } catch {}
  try {
    spawnSync("xattr", ["-d", AI_CLASSIFIED_TAG, filePath]);
  } catch {}
}
