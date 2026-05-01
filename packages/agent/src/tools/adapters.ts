import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DbClient } from "@agents/db";
import type { UserToolSetting, UserIntegration } from "@agents/types";
import { TOOL_CATALOG } from "@agents/types";
import { TOOL_SCHEMAS } from "./schemas";
import { withTracking } from "./withTracking";
import { executeBash } from "./bashExec";
import { executeReadFile, executeWriteFile, executeEditFile } from "./fileTools";

const GITHUB_API = "https://api.github.com";
const GITHUB_UA = "10x-builders-agent/1.0";

export interface ToolContext {
  db: DbClient;
  userId: string;
  sessionId: string;
  enabledTools: UserToolSetting[];
  integrations: UserIntegration[];
  githubToken?: string;
}

function isToolAvailable(toolId: string, ctx: ToolContext): boolean {
  const setting = ctx.enabledTools.find((t) => t.tool_id === toolId);
  if (!setting?.enabled) return false;

  const def = TOOL_CATALOG.find((t) => t.id === toolId);
  if (def?.requires_integration) {
    const hasIntegration = ctx.integrations.some(
      (i) => i.provider === def.requires_integration && i.status === "active"
    );
    if (!hasIntegration) return false;
  }
  return true;
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": GITHUB_UA,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...ghHeaders(token), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  return res.json();
}

function requireGithubToken(ctx: ToolContext): string | null {
  if (!ctx.githubToken?.trim()) return null;
  return ctx.githubToken;
}

function githubNotConnectedPayload(): Record<string, unknown> {
  return {
    error:
      "GitHub no está conectado o el token no está disponible. Conecta tu cuenta en Ajustes.",
    code: "github_not_connected",
  };
}

export async function executeGitHubTool(
  toolName: string,
  args: Record<string, unknown>,
  token: string
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case "github_list_repos": {
      const raw = (args.per_page as number) || 10;
      const perPage = Math.min(100, Math.max(1, Math.floor(raw) || 10));
      const repos = await ghFetch(token, `/user/repos?per_page=${perPage}&sort=updated`);
      return {
        repos: (repos as Array<Record<string, unknown>>).map((r) => ({
          full_name: r.full_name,
          description: r.description,
          html_url: r.html_url,
          private: r.private,
          language: r.language,
          updated_at: r.updated_at,
        })),
      };
    }
    case "github_list_issues": {
      const state = (args.state as string) || "open";
      const raw = await ghFetch(
        token,
        `/repos/${encodeURIComponent(String(args.owner))}/${encodeURIComponent(String(args.repo))}/issues?state=${encodeURIComponent(state)}&per_page=50`
      );
      const rows = raw as Array<Record<string, unknown>>;
      const issuesOnly = rows.filter((i) => !("pull_request" in i));
      return {
        issues: issuesOnly.map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          html_url: i.html_url,
          created_at: i.created_at,
          user: (i.user as Record<string, unknown>)?.login,
        })),
      };
    }
    case "github_create_issue": {
      const issue = await ghFetch(
        token,
        `/repos/${encodeURIComponent(String(args.owner))}/${encodeURIComponent(String(args.repo))}/issues`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: args.title, body: args.body ?? "" }),
        }
      );
      return {
        message: "Issue created",
        issue_number: (issue as Record<string, unknown>).number,
        issue_url: (issue as Record<string, unknown>).html_url,
      };
    }
    case "github_create_repo": {
      const repo = await ghFetch(token, "/user/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: args.name,
          description: args.description ?? "",
          private: args.isPrivate ?? false,
        }),
      });
      return {
        message: "Repository created",
        full_name: (repo as Record<string, unknown>).full_name,
        html_url: (repo as Record<string, unknown>).html_url,
      };
    }
    default:
      throw new Error(`Unknown GitHub tool: ${toolName}`);
  }
}

type ToolHandlers = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in string]: (input: any, ctx: ToolContext) => Promise<Record<string, unknown>>;
};

export const TOOL_HANDLERS: ToolHandlers = {
  get_user_preferences: async (_input, ctx) => {
    const { getProfile } = await import("@agents/db");
    const profile = await getProfile(ctx.db, ctx.userId);
    return {
      name: profile.name,
      timezone: profile.timezone,
      language: profile.language,
      agent_name: profile.agent_name,
    };
  },

  list_enabled_tools: async (_input, ctx) => {
    const enabled = ctx.enabledTools.filter((t) => t.enabled).map((t) => t.tool_id);
    return { enabled };
  },

  github_list_repos: async (input, ctx) => {
    const t = requireGithubToken(ctx);
    if (!t) return githubNotConnectedPayload();
    return executeGitHubTool("github_list_repos", input, t);
  },

  github_list_issues: async (input, ctx) => {
    const t = requireGithubToken(ctx);
    if (!t) return githubNotConnectedPayload();
    return executeGitHubTool("github_list_issues", input, t);
  },

  github_create_issue: async (input, ctx) => {
    const t = requireGithubToken(ctx);
    if (!t) return githubNotConnectedPayload();
    return executeGitHubTool("github_create_issue", input, t);
  },

  github_create_repo: async (input, ctx) => {
    const t = requireGithubToken(ctx);
    if (!t) return githubNotConnectedPayload();
    return executeGitHubTool("github_create_repo", input, t);
  },

  read_file: async (input: { path: string; offset?: number; limit?: number }) => {
    const result = await executeReadFile(input);
    return result as unknown as Record<string, unknown>;
  },

  write_file: async (input: { path: string; content: string }) => {
    const result = await executeWriteFile(input);
    return result as unknown as Record<string, unknown>;
  },

  edit_file: async (input: { path: string; old_string: string; new_string: string }) => {
    const result = await executeEditFile(input);
    return result as unknown as Record<string, unknown>;
  },

  bash: async (input: { terminal: string; prompt: string }) => {
    const result = await executeBash(input.terminal, input.prompt);
    return result as unknown as Record<string, unknown>;
  },

  schedule_task: async (
    input: {
      prompt: string;
      schedule_type: "one_time" | "recurring";
      run_at?: string;
      cron_expr?: string;
      timezone?: string;
    },
    ctx: ToolContext
  ) => {
    const { Cron } = await import("croner");
    const { createScheduledTask } = await import("@agents/db");
    const { getProfile } = await import("@agents/db");

    const profile = await getProfile(ctx.db, ctx.userId);
    const tz = input.timezone ?? profile.timezone ?? "UTC";

    let nextRunAt: string;

    if (input.schedule_type === "one_time") {
      if (!input.run_at) throw new Error("run_at is required for one_time tasks");
      nextRunAt = new Date(input.run_at).toISOString();
    } else {
      if (!input.cron_expr) throw new Error("cron_expr is required for recurring tasks");
      const job = new Cron(input.cron_expr, { timezone: tz });
      const next = job.nextRun();
      if (!next) throw new Error("Could not compute next run from cron expression");
      nextRunAt = next.toISOString();
    }

    const task = await createScheduledTask(ctx.db, {
      userId: ctx.userId,
      prompt: input.prompt,
      scheduleType: input.schedule_type,
      runAt: input.run_at,
      cronExpr: input.cron_expr,
      timezone: tz,
      nextRunAt,
    });

    const readableTime = new Date(nextRunAt).toLocaleString("es", {
      timeZone: tz,
      dateStyle: "full",
      timeStyle: "short",
    });

    return {
      ok: true,
      task_id: task.id,
      schedule_type: task.schedule_type,
      next_run_at: nextRunAt,
      message:
        input.schedule_type === "one_time"
          ? `Tarea programada para el ${readableTime} (${tz}). Recibirás el resultado por Telegram.`
          : `Tarea recurrente creada con expresión "${input.cron_expr}". Próxima ejecución: ${readableTime} (${tz}).`,
    };
  },
};

export function buildLangChainTools(ctx: ToolContext) {
  const tools = [];

  for (const def of TOOL_CATALOG) {
    if (!isToolAvailable(def.id, ctx)) continue;

    const schema = TOOL_SCHEMAS[def.id as keyof typeof TOOL_SCHEMAS];
    const handler = TOOL_HANDLERS[def.id];
    if (!schema || !handler) continue;

    const trackedHandler = withTracking(def.id, handler, ctx);

    tools.push(
      tool(trackedHandler, {
        name: def.name,
        description: def.description,
        schema: schema as z.ZodTypeAny,
      })
    );
  }

  return tools;
}
