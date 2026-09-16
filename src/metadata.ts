import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { FileInfo, FileMetadata } from "./types.js";
import { getAllTags } from "./xattr.js";

export function extractFileInfo(filePath: string): FileInfo {
  const stats = statSync(filePath);
  const name = basename(filePath);
  const extension = extname(name).toLowerCase();
  const existingTags = getAllTags(filePath);

  return {
    path: filePath,
    name,
    extension,
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    existingTags,
  };
}

export async function extractMetadata(filePath: string, tokenCount: number): Promise<FileMetadata> {
  const content = await readFile(filePath, "utf8");
  const info = extractFileInfo(filePath);

  return {
    info,
    content,
    tokenCount,
  };
}
