import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const STORE_DIRECTORY = ".sailkari";
const STORE_FILE = "results.json";
const STORE_VERSION = 1;

interface StoredResult {
  labels: string[];
}

interface StoredResultsFile {
  version: number;
  files: Record<string, StoredResult>;
}

function emptyResults(): StoredResultsFile {
  return { version: STORE_VERSION, files: {} };
}

export class ClassificationStore {
  private readonly root: string;
  private readonly filePath: string;
  private results: StoredResultsFile;
  private loaded = false;

  constructor(folderPath: string) {
    this.root = resolve(folderPath);
    this.filePath = join(this.root, STORE_DIRECTORY, STORE_FILE);
    this.results = emptyResults();
  }

  has(filePath: string): boolean {
    this.load();
    return this.keyFor(filePath) in this.results.files;
  }

  getLabels(filePath: string): string[] {
    this.load();
    return [...(this.results.files[this.keyFor(filePath)]?.labels ?? [])];
  }

  getTags(filePath: string): string[] {
    const labels = this.getLabels(filePath);
    if (this.has(filePath)) {
      return [...labels, "ai-classified"];
    }
    return labels;
  }

  setLabels(filePath: string, labels: string[]): void {
    this.load();
    this.results.files[this.keyFor(filePath)] = { labels: [...labels] };
    this.save();
  }

  remove(filePath: string): void {
    this.load();
    delete this.results.files[this.keyFor(filePath)];
    this.save();
  }

  entries(): { filePath: string; labels: string[] }[] {
    this.load();
    return Object.entries(this.results.files).map(([key, value]) => ({
      filePath: join(this.root, key.split("/").join(sep)),
      labels: [...value.labels],
    }));
  }

  private keyFor(filePath: string): string {
    return relative(this.root, resolve(filePath)).split(sep).join("/");
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<StoredResultsFile>;
      if (parsed.version === STORE_VERSION && parsed.files && typeof parsed.files === "object") {
        this.results = {
          version: STORE_VERSION,
          files: Object.fromEntries(
            Object.entries(parsed.files).filter(([, value]) => {
              return value && Array.isArray((value as StoredResult).labels);
            })
          ) as Record<string, StoredResult>,
        };
      }
    } catch {
      this.results = emptyResults();
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(temporaryPath, JSON.stringify(this.results, null, 2) + "\n", "utf8");
    renameSync(temporaryPath, this.filePath);
  }
}

export function isClassificationStorePath(filePath: string): boolean {
  return filePath.split(sep).includes(STORE_DIRECTORY);
}
