import { test, expect, describe } from "bun:test";
import { parseResponse, selectLabelByMajority } from "./parser.js";
import type { Label } from "./types.js";

const labels: Label[] = [
  { name: "family", description: "family docs" },
  { name: "banking", description: "banking docs" },
  { name: "pets", description: "pet docs" },
];

describe("parseResponse", () => {
  test("reads a bare label name", () => {
    expect(parseResponse("banking", labels)?.labels).toEqual(["banking"]);
  });

  test("is case-insensitive", () => {
    expect(parseResponse("BANKING", labels)?.labels).toEqual(["banking"]);
  });

  test("reads JSON { labels: [...] }", () => {
    expect(parseResponse('{"labels":["pets"]}', labels)?.labels).toEqual(["pets"]);
  });

  test("returns null for empty or unknown text", () => {
    expect(parseResponse("", labels)).toBeNull();
    expect(parseResponse("nope", labels)).toBeNull();
  });
});

describe("selectLabelByMajority", () => {
  test("returns the most frequent label", () => {
    expect(selectLabelByMajority({ family: 1, banking: 3, pets: 2 })).toBe("banking");
  });

  test("returns null when empty", () => {
    expect(selectLabelByMajority({})).toBeNull();
  });
});
