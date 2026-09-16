import { readdirSync } from "node:fs";
import { join } from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".xml",
  ".log", ".conf", ".config", ".ini", ".toml", ".properties",
]);

export function isTextFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const ext of TEXT_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export function scanFolder(folderPath: string): string[] {
  const files: string[] = [];

  try {
    for (const entry of readdirSync(folderPath, { withFileTypes: true })) {
      const path = join(folderPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...scanFolder(path));
      } else if (entry.isFile() && isTextFile(path)) {
        files.push(path);
      }
    }
  } catch (error) {
    throw new Error(`Cannot access folder: ${folderPath}`, { cause: error });
  }

  return files;
}
