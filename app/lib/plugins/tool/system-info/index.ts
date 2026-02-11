import {
  platform,
  arch,
  hostname,
  cpus,
  totalmem,
  freemem,
  uptime,
  networkInterfaces,
  userInfo,
  release,
  type,
  homedir,
} from "node:os";
import { exec } from "node:child_process";
import type { Tool, ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";

const EXEC_TIMEOUT_MS = 5_000;

function execPromise(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: "utf-8", timeout: EXEC_TIMEOUT_MS }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Disk usage
// ---------------------------------------------------------------------------

async function getDiskUsage(): Promise<string> {
  try {
    const output = await execPromise("df -h /");
    const lines = output.split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      // Filesystem Size Used Avail Use%
      return `${parts[2] ?? "?"} used / ${parts[1] ?? "?"} total (${parts[4] ?? "?"} used)`;
    }
    return "unknown";
  } catch {
    return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// Battery (macOS)
// ---------------------------------------------------------------------------

async function getBattery(): Promise<string | null> {
  const os = platform();

  if (os === "darwin") {
    try {
      const output = await execPromise("pmset -g batt");
      const match = output.match(/(\d+)%;\s*(\w+)/);
      if (match) {
        return `${match[1]}% (${match[2]})`;
      }
      return "unknown";
    } catch {
      return null;
    }
  }

  if (os === "linux") {
    try {
      const capacity = await execPromise("cat /sys/class/power_supply/BAT0/capacity");
      const status = await execPromise("cat /sys/class/power_supply/BAT0/status");
      return `${capacity.trim()}% (${status.trim().toLowerCase()})`;
    } catch {
      return null; // No battery (desktop)
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Network info
// ---------------------------------------------------------------------------

function getNetworkSummary(): string {
  const ifaces = networkInterfaces();
  const entries: string[] = [];

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs || name === "lo" || name === "lo0") continue;

    const ipv4 = addrs.find((a) => a.family === "IPv4" && !a.internal);
    if (ipv4) {
      entries.push(`${name}: ${ipv4.address}`);
    }
  }

  return entries.length > 0 ? entries.join(", ") : "no active interfaces";
}

// ---------------------------------------------------------------------------
// system_overview
// ---------------------------------------------------------------------------

const systemOverviewTool: Tool = {
  name: "system_overview",
  description:
    "Get a comprehensive overview of the host machine: OS, CPU, memory, disk, " +
    "network interfaces, uptime, battery status, and user info. " +
    "Use this to understand the system you're running on.",
  keywords: [
    "system",
    "info",
    "hardware",
    "cpu",
    "memory",
    "ram",
    "disk",
    "storage",
    "network",
    "battery",
    "os",
    "uptime",
    "machine",
    "computer",
    "status",
  ],
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  permissions: "read",

  async execute() {
    const cpuInfo = cpus();
    const cpuModel = cpuInfo.length > 0 ? cpuInfo[0].model : "unknown";
    const cpuCount = cpuInfo.length;

    const totalMem = totalmem();
    const freeMem = freemem();
    const usedMem = totalMem - freeMem;

    const disk = await getDiskUsage();
    const battery = await getBattery();
    const network = getNetworkSummary();
    const user = userInfo();

    const sections = [
      `**OS:** ${type()} ${release()} (${platform()} ${arch()})`,
      `**Hostname:** ${hostname()}`,
      `**User:** ${user.username} (home: ${homedir()})`,
      `**CPU:** ${cpuModel} (${cpuCount} cores)`,
      `**Memory:** ${formatBytes(usedMem)} used / ${formatBytes(totalMem)} total (${formatBytes(freeMem)} free)`,
      `**Disk:** ${disk}`,
      `**Network:** ${network}`,
      `**Uptime:** ${formatUptime(uptime())}`,
    ];

    if (battery) {
      sections.push(`**Battery:** ${battery}`);
    }

    return {
      success: true,
      data: sections.join("\n"),
    };
  },
};

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createSystemInfoPlugin(logger: Logger): ToolPlugin {
  const log = logger.child({ plugin: "system-info" });

  return {
    id: "system-info",
    name: "System Info",
    type: "tool",
    description: "System hardware and software information",
    tools: [systemOverviewTool],
    afterToolCall: (_toolName, _params, _context, result) => {
      if (!result.success) {
        log.warn({ error: result.error }, "System info failed");
      }
    },
  };
}
