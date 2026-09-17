const MAX_HISTORY_ENTRIES = 100;

export class CommandHistory {
  private entries: string[];
  private position: number;
  private draft = "";

  constructor(entries: string[] = []) {
    this.entries = entries.slice(-MAX_HISTORY_ENTRIES);
    this.position = this.entries.length;
  }

  load(entries: string[]): void {
    this.entries = entries.slice(-MAX_HISTORY_ENTRIES);
    this.position = this.entries.length;
    this.draft = "";
  }

  all(): readonly string[] {
    return this.entries;
  }

  record(command: string): void {
    const value = command.trim();
    if (!value) return;
    if (this.entries.at(-1) === value) {
      this.position = this.entries.length;
      return;
    }
    this.entries.push(value);
    this.entries = this.entries.slice(-MAX_HISTORY_ENTRIES);
    this.position = this.entries.length;
  }

  reset(): void {
    this.position = this.entries.length;
    this.draft = "";
  }

  previous(currentInput: string): string | undefined {
    if (this.entries.length === 0) return undefined;
    if (this.position === this.entries.length) this.draft = currentInput;
    this.position = Math.max(0, this.position - 1);
    return this.entries[this.position];
  }

  next(): string | undefined {
    if (this.position >= this.entries.length) return undefined;
    this.position++;
    return this.position === this.entries.length ? this.draft : this.entries[this.position];
  }
}