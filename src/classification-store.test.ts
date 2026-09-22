import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClassificationStore } from "./classification-store.js";

describe("ClassificationStore", () => {
  test("persists labels without operating-system attributes", async () => {
    const folder = await mkdtemp(join(tmpdir(), "sailkari-store-"));
    const file = join(folder, "my document.txt");
    const store = new ClassificationStore(folder);

    store.setLabels(file, ["banking"]);

    const reloaded = new ClassificationStore(folder);
    expect(reloaded.has(file)).toBe(true);
    expect(reloaded.getLabels(file)).toEqual(["banking"]);
    expect(reloaded.getTags(file)).toEqual(["banking", "ai-classified"]);
    expect(JSON.parse(await readFile(join(folder, ".sailkari", "results.json"), "utf8")).files["my document.txt"].labels).toEqual(["banking"]);
  });

  test("ignores malformed store data", async () => {
    const folder = await mkdtemp(join(tmpdir(), "sailkari-store-"));
    await writeFile(join(folder, ".sailkari.json"), "invalid", "utf8");
    const store = new ClassificationStore(folder);
    expect(store.entries()).toEqual([]);
  });
});
