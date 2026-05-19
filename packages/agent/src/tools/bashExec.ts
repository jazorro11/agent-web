import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";

const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 4 * 1024 * 1024; // 4 MB
const MAX_COMMAND_LENGTH = 2_000;

// Patterns that could cause irreversible damage or data exfiltration — bash/sh
const BLOCKED_PATTERNS_UNIX: RegExp[] = [
  /rm\s+-rf?\s+[/~]/i,            // rm -rf /  or  rm -r ~/
  /:\s*\(\s*\)\s*\{.*\|.*\&.*\}/, // fork bomb: :(){:|:&};:
  /curl\s+.*\|\s*(ba)?sh/i,        // curl … | bash
  /wget\s+.*\|\s*(ba)?sh/i,        // wget … | bash
  /\bmkfs\b/i,                     // filesystem formatting
  /\bdd\s+.*of=\/dev\//i,          // raw device write
  />\s*\/dev\/sd[a-z]/i,           // redirect to block device
  /chmod\s+[0-7]*7[0-7]*\s+\/etc/i, // world-write /etc
];

// Patterns that could cause irreversible damage — PowerShell
const BLOCKED_PATTERNS_WIN: RegExp[] = [
  /Remove-Item\s+.*-Recurse.*-Force\s+[A-Z]:\\/i,  // Delete root of a drive
  /Remove-Item\s+.*-Force.*-Recurse\s+[A-Z]:\\/i,
  /(Invoke-Expression|iex)\s+.*Invoke-WebRequest/i, // Download & execute
  /(Invoke-Expression|iex)\s+.*Invoke-RestMethod/i,
  /(Invoke-Expression|iex)\s+.*curl/i,
  /\b(Format-Volume|Format-Disk|Clear-Disk)\b/i,   // Disk formatting
  /\bdd\s+.*of=\\\\\./i,                            // Raw device write (Win)
];

export interface BashResult {
  terminal: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function executeBash(terminal: string, prompt: string): Promise<BashResult> {
  if (process.env.BASH_TOOL_ENABLED !== "true") {
    return {
      terminal,
      stdout: "",
      stderr: "Bash tool is disabled. Set BASH_TOOL_ENABLED=true to enable it.",
      exitCode: 1,
    };
  }

  if (prompt.length > MAX_COMMAND_LENGTH) {
    return {
      terminal,
      stdout: "",
      stderr: `Command exceeds maximum allowed length of ${MAX_COMMAND_LENGTH} characters.`,
      exitCode: 1,
    };
  }

  const isWindows = process.platform === "win32";
  const patterns = isWindows ? BLOCKED_PATTERNS_WIN : BLOCKED_PATTERNS_UNIX;

  for (const pattern of patterns) {
    if (pattern.test(prompt)) {
      return {
        terminal,
        stdout: "",
        stderr: `Command blocked: matches a prohibited pattern (${pattern.source}).`,
        exitCode: 1,
      };
    }
  }

  const cwd = await resolveCwd();

  if (isWindows) {
    return runPowerShell(terminal, prompt, cwd);
  }
  return runBash(terminal, prompt, cwd);
}

function runBash(terminal: string, prompt: string, cwd: string): Promise<BashResult> {
  return new Promise((resolve) => {
    execFile(
      "bash",
      ["-lc", prompt],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout, stderr) => {
        const exitCode =
          error?.code !== undefined && typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;
        resolve({ terminal, stdout: stdout ?? "", stderr: stderr ?? "", exitCode });
      }
    );
  });
}

function runPowerShell(terminal: string, prompt: string, cwd: string): Promise<BashResult> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NonInteractive", "-Command", prompt],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout, stderr) => {
        const exitCode =
          error?.code !== undefined && typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;
        resolve({ terminal, stdout: stdout ?? "", stderr: stderr ?? "", exitCode });
      }
    );
  });
}

async function resolveCwd(): Promise<string> {
  const envCwd = process.env.BASH_TOOL_CWD;
  if (!envCwd) return process.cwd();

  try {
    const info = await stat(envCwd);
    if (!info.isDirectory()) {
      console.warn(`[bash] BASH_TOOL_CWD "${envCwd}" is not a directory, falling back to process.cwd()`);
      return process.cwd();
    }
    return envCwd;
  } catch {
    console.warn(`[bash] BASH_TOOL_CWD "${envCwd}" does not exist, falling back to process.cwd()`);
    return process.cwd();
  }
}
