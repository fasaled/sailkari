import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SERVICE_NAME = "sailkari";

export function getCredentialsPath(): string {
  return join(homedir(), ".config", "sailkari", "credentials.json");
}

export interface CredentialStoreBackend {
  get(provider: string): Promise<string | undefined>;
  set(provider: string, secret: string): Promise<void>;
  delete(provider: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// 1. OS Native Keychain Backend (macOS Keychain & Windows DPAPI)
// ---------------------------------------------------------------------------

export class MacKeychainBackend implements CredentialStoreBackend {
  async get(provider: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync("/usr/bin/security", [
        "find-generic-password",
        "-s",
        SERVICE_NAME,
        "-a",
        provider,
        "-w",
      ]);
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async set(provider: string, secret: string): Promise<void> {
    try {
      await execFileAsync("/usr/bin/security", [
        "add-generic-password",
        "-U",
        "-s",
        SERVICE_NAME,
        "-a",
        provider,
        "-w",
        secret,
      ]);
    } catch (err) {
      throw new Error(`Failed to store secret in macOS Keychain: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async delete(provider: string): Promise<boolean> {
    try {
      await execFileAsync("/usr/bin/security", [
        "delete-generic-password",
        "-s",
        SERVICE_NAME,
        "-a",
        provider,
      ]);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Modern Windows Backend using native Windows DPAPI (Data Protection API) via
 * System.Security.Cryptography.ProtectedData (DataProtectionScope.CurrentUser).
 * This is the standard mechanism used by Chromium, VS Code, and Git Credential Manager.
 */
export class WindowsDpapiBackend implements CredentialStoreBackend {
  private getStorePath(): string {
    const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
    return join(localAppData, "sailkari", "credentials.dpapi");
  }

  private async readAll(): Promise<Record<string, string>> {
    const storePath = this.getStorePath();
    try {
      await stat(storePath);
    } catch {
      return {};
    }

    const script = `
Add-Type -AssemblyName System.Security
$path = '${storePath.replace(/'/g, "''")}'
if (Test-Path $path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Write([System.Text.Encoding]::UTF8.GetString($decrypted))
}
`.trim();

    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
      if (!stdout.trim()) return {};
      return JSON.parse(stdout) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async writeAll(data: Record<string, string>): Promise<void> {
    const storePath = this.getStorePath();
    const json = JSON.stringify(data);
    const b64 = Buffer.from(json, "utf8").toString("base64");

    const script = `
Add-Type -AssemblyName System.Security
$path = '${storePath.replace(/'/g, "''")}'
$dir = [System.IO.Path]::GetDirectoryName($path)
if (-not (Test-Path $dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
$plainBytes = [System.Convert]::FromBase64String('${b64}')
$encrypted = [System.Security.Cryptography.ProtectedData]::Protect($plainBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.IO.File]::WriteAllBytes($path, $encrypted)
`.trim();

    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  }

  async get(provider: string): Promise<string | undefined> {
    const all = await this.readAll();
    return all[provider];
  }

  async set(provider: string, secret: string): Promise<void> {
    const all = await this.readAll();
    all[provider] = secret;
    await this.writeAll(all);
  }

  async delete(provider: string): Promise<boolean> {
    const all = await this.readAll();
    if (!(provider in all)) return false;
    delete all[provider];
    if (Object.keys(all).length === 0) {
      try {
        await unlink(this.getStorePath());
      } catch {
        // Ignored
      }
    } else {
      await this.writeAll(all);
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// 2. Strict Permissions (0600) File Backend (Linux / Fallback)
// ---------------------------------------------------------------------------

export class StrictFileBackend implements CredentialStoreBackend {
  constructor(private readonly filePath = getCredentialsPath()) {}

  private async readStore(): Promise<Record<string, string>> {
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const result: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof k === "string" && typeof v === "string") {
            result[k] = v;
          }
        }
        return result;
      }
      return {};
    } catch {
      return {};
    }
  }

  private async writeStore(data: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    try {
      await chmod(tmp, 0o600);
    } catch {
      // Best effort (e.g. non-POSIX filesystems)
    }
    await rename(tmp, this.filePath);
    try {
      await chmod(this.filePath, 0o600);
    } catch {
      // Best effort
    }
  }

  async get(provider: string): Promise<string | undefined> {
    const store = await this.readStore();
    return store[provider];
  }

  async set(provider: string, secret: string): Promise<void> {
    const store = await this.readStore();
    store[provider] = secret;
    await this.writeStore(store);
  }

  async delete(provider: string): Promise<boolean> {
    const store = await this.readStore();
    if (!(provider in store)) return false;
    delete store[provider];
    if (Object.keys(store).length === 0) {
      try {
        await unlink(this.filePath);
      } catch {
        // Ignored
      }
    } else {
      await this.writeStore(store);
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// 3. Composite Store: Tries OS Keychain first, falls back to strict 0600 file
// ---------------------------------------------------------------------------

export class SecureCredentialStore {
  private primary: CredentialStoreBackend | null;
  private fallback: CredentialStoreBackend;

  constructor(options?: {
    primary?: CredentialStoreBackend | null;
    fallback?: CredentialStoreBackend;
  }) {
    this.fallback = options?.fallback ?? new StrictFileBackend();
    if (options && "primary" in options) {
      this.primary = options.primary ?? null;
    } else if (process.platform === "darwin") {
      this.primary = new MacKeychainBackend();
    } else if (process.platform === "win32") {
      this.primary = new WindowsDpapiBackend();
    } else {
      this.primary = null;
    }
  }

  async get(provider: string): Promise<string | undefined> {
    if (this.primary) {
      try {
        const val = await this.primary.get(provider);
        if (val) return val;
      } catch {
        // Fall back to file
      }
    }
    return this.fallback.get(provider);
  }

  async set(provider: string, secret: string): Promise<void> {
    if (this.primary) {
      try {
        await this.primary.set(provider, secret);
        // Also remove from fallback file if it was previously there
        await this.fallback.delete(provider).catch(() => {});
        return;
      } catch {
        // Primary failed (e.g. headless or permission denied), save to secure 0600 file
      }
    }
    await this.fallback.set(provider, secret);
  }

  async delete(provider: string): Promise<boolean> {
    let deleted = false;
    if (this.primary) {
      try {
        deleted = (await this.primary.delete(provider)) || deleted;
      } catch {
        // Ignored
      }
    }
    deleted = (await this.fallback.delete(provider)) || deleted;
    return deleted;
  }
}

export const defaultSecureStore = new SecureCredentialStore();
