import type { Command } from "./command-parser.js";

export type RunnableCommand = Exclude<Command, { type: "cancel" } | { type: "queue" }>;

export interface QueuedCommand {
  id: number;
  input: string;
  command: RunnableCommand;
}

export class CommandQueue {
  private commands: QueuedCommand[] = [];
  private nextId = 1;

  entries(): readonly QueuedCommand[] {
    return this.commands;
  }

  enqueue(input: string, command: RunnableCommand): QueuedCommand {
    const entry = { id: this.nextId++, input, command };
    this.commands.push(entry);
    return entry;
  }

  dequeue(): QueuedCommand | undefined {
    return this.commands.shift();
  }

  remove(position: number): QueuedCommand | undefined {
    if (position < 1 || position > this.commands.length) return undefined;
    return this.commands.splice(position - 1, 1)[0];
  }

  move(from: number, to: number): boolean {
    if (from < 1 || from > this.commands.length || to < 1 || to > this.commands.length) return false;
    const [entry] = this.commands.splice(from - 1, 1);
    this.commands.splice(to - 1, 0, entry!);
    return true;
  }

  clear(): number {
    const count = this.commands.length;
    this.commands = [];
    return count;
  }
}