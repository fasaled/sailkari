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

  test("completes key and provider subcommands", () => {
    expect(completeInput("k")).toEqual(["key"]);
    expect(completeInput("key ")).toEqual(["set", "get", "list", "remove"]);
    expect(completeInput("key s")).toEqual(["set"]);
    expect(completeInput("prov")).toEqual(["provider"]);
    expect(completeInput("provider ")).toEqual(["set", "add-model", "remove-model", "get", "list", "remove"]);
    expect(completeInput("provider s")).toEqual(["set"]);
  });

  test("completes configured providers and models dynamically", () => {
    const config = {
      providers: {
        typesafe: { apiKey: "key", models: ["jev", "jev-latest"] },
        openai: { apiKey: "key", models: ["gpt-4o-mini"] },
      },
    };

    expect(completeInput("provider get ", config)).toEqual(["typesafe", "openai"]);
    expect(completeInput("provider get typ", config)).toEqual(["typesafe"]);
    expect(completeInput("model typ", config)).toEqual(["typesafe:jev", "typesafe:jev-latest", "typesafe:"]);
    expect(completeInput("model ope", config)).toEqual(["openai:gpt-4o-mini", "openai:"]);
  });
});