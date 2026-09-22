import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeInput } from "./autocomplete.js";

describe("completeInput", () => {
  const originalDirectory = process.cwd();
  let fixtureDirectory: string;

  beforeEach(() => {
    fixtureDirectory = mkdtempSync(join(tmpdir(), "sailkari-autocomplete-"));
    mkdirSync(join(fixtureDirectory, "documents"));
    mkdirSync(join(fixtureDirectory, "documents", "archive"));
    mkdirSync(join(fixtureDirectory, "taxonomies"));
    writeFileSync(join(fixtureDirectory, "labels.yaml"), "family: Documents");
    writeFileSync(join(fixtureDirectory, "taxonomies", "categories.yaml"), "family: Documents");
    writeFileSync(join(fixtureDirectory, "documents", "labels.yaml"), "family: Documents");
    process.chdir(fixtureDirectory);
  });

  afterEach(() => {
    process.chdir(originalDirectory);
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  test("completes paths inside a directory with a trailing slash", () => {
    expect(completeInput("classify documents/")).toEqual(["documents/archive/"]);
  });

  test("lists matching folders for the classify folder argument", () => {
    expect(completeInput("classify doc")).toEqual(["documents/"]);
  });

  test("completes label files from the working directory", () => {
    expect(completeInput("classify documents/ lab")).toEqual(["labels.yaml"]);
    expect(completeInput("classify documents/ ")).toEqual(expect.arrayContaining(["documents/", "labels.yaml", "taxonomies/"]));
  });

  test("allows Tab navigation through folders while completing the labels file", () => {
    expect(completeInput("classify documents/ tax")).toEqual(["taxonomies/"]);
    expect(completeInput("classify documents/ taxonomies/")).toEqual(["taxonomies/categories.yaml"]);
  });

  test("completes key subcommands and providers", () => {
    expect(completeInput("k")).toEqual(["key"]);
    expect(completeInput("key ")).toEqual(["set", "get", "list", "remove"]);
    expect(completeInput("key s")).toEqual(["set"]);
    expect(completeInput("key set ")).toEqual(["typesafe", "jev", "openai", "groq", "openrouter"]);
    expect(completeInput("key get type")).toEqual(["typesafe"]);
    expect(completeInput("key remove j")).toEqual(["jev"]);
  });

  test("completes cloud model names for model command", () => {
    expect(completeInput("model je")).toEqual(["jev"]);
    expect(completeInput("model type")).toEqual(["typesafe:jev", "typesafe:jev-latest"]);
    expect(completeInput("model open")).toEqual(["openai:gpt-4o-mini", "openai:gpt-4o"]);
    expect(completeInput("model groq:")).toEqual(["groq:llama-3.3-70b-versatile", "groq:llama-3.1-8b-instant"]);
  });
});