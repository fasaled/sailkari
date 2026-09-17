import { describe, expect, test } from "vitest";
import { CommandQueue } from "./command-queue.js";

describe("CommandQueue", () => {
  test("removes and reorders commands by their displayed position", () => {
    const queue = new CommandQueue();
    queue.enqueue("help", { type: "help" });
    queue.enqueue("quit", { type: "quit" });
    queue.enqueue("prompt default", { type: "prompt", path: null });

    expect(queue.move(3, 1)).toBe(true);
    expect(queue.entries().map((entry) => entry.input)).toEqual(["prompt default", "help", "quit"]);
    expect(queue.remove(2)?.input).toBe("help");
    expect(queue.entries().map((entry) => entry.input)).toEqual(["prompt default", "quit"]);
  });
});