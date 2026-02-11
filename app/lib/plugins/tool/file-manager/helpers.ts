import { exec } from "node:child_process";
import { homedir } from "node:os";
import { resolve, basename } from "node:path";

// ---------------------------------------------------------------------------
// Dangerous-path protection
// ---------------------------------------------------------------------------

const BLOCKED_PATHS = new Set([
  "/",
  "/bin",
  "/sbin",
  "/usr",
  "/usr/bin",
  "/usr/sbin",
  "/usr/local",
  "/etc",
  "/var",
  "/System",
  "/Library",
  "/Applications",
  "/private",
  "/dev",
  "/proc",
  "/sys",
  "/boot",
  "/root",
]);

export function isBlockedPath(filePath: string): boolean {
  const abs = resolve(filePath);
  const home = homedir();

  if (BLOCKED_PATHS.has(abs)) return true;
  if (abs === home) return true;

  return false;
}

export function isGrayAreaPath(filePath: string): { risky: boolean; reason?: string } {
  const abs = resolve(filePath);
  const home = homedir();
  const name = basename(abs);

  // Hidden config directories in home
  if (abs.startsWith(home) && name.startsWith(".") && abs.split("/").length <= home.split("/").length + 2) {
    return { risky: true, reason: `"${abs}" is a hidden config path in your home directory` };
  }

  // Anything directly inside root-level system dirs
  for (const blocked of BLOCKED_PATHS) {
    if (abs.startsWith(`${blocked}/`) && abs.split("/").length <= blocked.split("/").length + 2) {
      return { risky: true, reason: `"${abs}" is inside a system directory (${blocked})` };
    }
  }

  return { risky: false };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function execPromise(
  cmd: string,
  opts: { timeout?: number } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: "utf-8", timeout: opts.timeout ?? 30_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve(stdout);
      }
    });
  });
}

export function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`which ${cmd}`, (error) => resolve(!error));
  });
}

export const MAX_READ_CHARS = 100_000;
export const MAX_SEARCH_OUTPUT = 50_000;
