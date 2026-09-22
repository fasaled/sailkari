import { describe, expect, test } from "bun:test";
import { CommandHistory } from "./command-history.js";

describe("CommandHistory", () => {
  test("navigates backward and forward while restoring the unfinished draft", () => {
    const history = new CommandHistory(["help", "queue"]);

    expect(history.previous("classify documents labels.yaml")).toBe("queue");
    expect(history.previous("queue")).toBe("help");
    expect(history.next()).toBe("queue");
    expect(history.next()).toBe("classify documents labels.yaml");
  });

  test("keeps only the latest 100 entries and removes consecutive duplicates", () => {
    const history = new CommandHistory();
    for (let index = 0; index < 101; index++) history.record(`command ${index}`);
    history.record("command 100");

    expect(history.all()).toHaveLength(100);
    expect(history.all()[0]).toBe("command 1");
  });
});