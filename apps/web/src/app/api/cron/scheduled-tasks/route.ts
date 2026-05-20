import { NextResponse } from "next/server";
import { Cron } from "croner";
import {
  createServerClient,
  decrypt,
  claimDueTasks,
  createTaskRun,
  completeTaskRun,
  failTaskRun,
} from "@agents/db";
import { runAgent, resolveGoogleToken } from "@agents/agent";
import { notifyUserViaTelegram } from "@/lib/telegram/send";
import type { ScheduledTask, UserToolSetting, UserIntegration } from "@agents/types";

const CRON_SECRET = process.env.CRON_SECRET ?? "";

function computeNextRunAt(task: ScheduledTask): string | null {
  if (task.schedule_type === "one_time") return null;
  if (!task.cron_expr) return null;
  try {
    const job = new Cron(task.cron_expr, { timezone: task.timezone });
    const next = job.nextRun();
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

async function buildAgentContextForTask(
  db: ReturnType<typeof createServerClient>,
  userId: string,
  sessionId: string
) {
  const { data: profile } = await db
    .from("profiles")
    .select("agent_system_prompt")
    .eq("id", userId)
    .single();

  const { data: toolSettings } = await db
    .from("user_tool_settings")
    .select("*")
    .eq("user_id", userId);

  const { data: integrations } = await db
    .from("user_integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active");

  let githubToken: string | undefined;
  const githubIntegration = (integrations ?? []).find(
    (i: Record<string, unknown>) => i.provider === "github"
  );
  if (githubIntegration?.encrypted_tokens) {
    try {
      githubToken = decrypt(githubIntegration.encrypted_tokens as string);
    } catch {
      githubToken = undefined;
    }
  }

  let googleToken: string | undefined;
  const hasGoogle = (integrations ?? []).some(
    (i: Record<string, unknown>) => i.provider === "google"
  );
  if (hasGoogle) {
    try {
      const t = await resolveGoogleToken(db, userId);
      if (t) googleToken = t;
    } catch {
      googleToken = undefined;
    }
  }

  return {
    userId,
    sessionId,
    systemPrompt:
      (profile?.agent_system_prompt as string) ??
      "Eres un asistente útil que ayuda al usuario a gestionar tareas.",
    db,
    enabledTools: ((toolSettings ?? []) as Record<string, unknown>[]).map((t) => ({
      id: t.id as string,
      user_id: t.user_id as string,
      tool_id: t.tool_id as string,
      enabled: t.enabled as boolean,
      config_json: (t.config_json as Record<string, unknown>) ?? {},
    })) as UserToolSetting[],
    integrations: ((integrations ?? []) as Record<string, unknown>[]).map((i) => ({
      id: i.id as string,
      user_id: i.user_id as string,
      provider: i.provider as string,
      scopes: (i.scopes as string[]) ?? [],
      status: i.status as "active" | "revoked" | "expired",
      created_at: i.created_at as string,
    })) as UserIntegration[],
    githubToken,
    googleToken,
  };
}

async function getOrCreateCronSession(
  db: ReturnType<typeof createServerClient>,
  userId: string,
  taskId: string
): Promise<string> {
  // Each task gets its own dedicated cron session so the LangGraph thread
  // state is isolated and does not interfere with the user's web/telegram sessions.
  const { data: existing } = await db
    .from("agent_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("channel", "cron")
    .eq("status", "active")
    // Use task_id stored in a metadata column via a naming convention: we filter
    // by matching the session description we embed in the RPC below.
    // Simpler: one cron session per task (identified by task_id in metadata).
    // For v1 we create a fresh session per run to keep history per-execution.
    .limit(1)
    .maybeSingle();

  // Always create a new session per run for clean history per execution.
  void existing; // acknowledged but not reused in v1

  const { data: session, error } = await db
    .from("agent_sessions")
    .insert({
      user_id: userId,
      channel: "cron",
      status: "active",
      budget_tokens_used: 0,
      budget_tokens_limit: 100000,
      last_used_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !session) {
    throw new Error(`Failed to create cron session for task ${taskId}: ${error?.message}`);
  }

  return session.id as string;
}

export async function POST(request: Request) {
  // Authenticate request from Supabase Cron (or manual trigger)
  const authHeader = request.headers.get("authorization");
  const secret = authHeader?.replace("Bearer ", "") ?? "";

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServerClient();

  let tasks: ScheduledTask[];
  try {
    tasks = await claimDueTasks(db, 20);
  } catch (err) {
    console.error("[cron] Failed to claim due tasks:", err);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }

  if (tasks.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const results = await Promise.allSettled(
    tasks.map((task) => handleTaskWithRetry(db, task))
  );

  const summary = results.map((r, i) => ({
    task_id: tasks[i].id,
    status: r.status === "fulfilled" ? "ok" : "error",
    ...(r.status === "rejected" ? { error: String(r.reason) } : {}),
  }));

  console.log("[cron] Processed tasks:", JSON.stringify(summary));

  return NextResponse.json({ processed: tasks.length, results: summary });
}

async function handleTaskWithRetry(
  db: ReturnType<typeof createServerClient>,
  task: ScheduledTask
): Promise<void> {
  const maxAttempts = task.max_retries + 1;
  let lastError: string = "";
  let lastSessionId: string | undefined;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    const retryCount = attemptNumber - 1;

    // Create task run for this attempt
    const run = await createTaskRun(db, {
      taskId: task.id,
      attemptNumber,
      retryCount,
      retryReason: retryCount > 0 ? lastError : undefined,
    });

    try {
      // Get or create session and build context
      lastSessionId = await getOrCreateCronSession(db, task.user_id, task.id);
      const ctx = await buildAgentContextForTask(db, task.user_id, lastSessionId);

      // Execute agent
      const result = await runAgent({ ...ctx, message: task.prompt, bypassConfirmation: true });

      // Success path: complete the run and notify
      const nextRunAt = computeNextRunAt(task);
      const newStatus = task.schedule_type === "one_time" ? "completed" : "active";

      const notificationText = buildNotificationText(task, result.response);
      const { notified, reason } = await notifyUserViaTelegram(db, task.user_id, notificationText);

      await completeTaskRun(db, {
        runId: run.id,
        taskId: task.id,
        agentSessionId: lastSessionId,
        nextRunAt: newStatus === "active" ? nextRunAt : null,
        newStatus,
        notified,
        notificationError: reason,
      });

      // Exit on success
      return;
    } catch (err) {
      lastError = String(err).substring(0, 500);
      console.error(`[cron] Task ${task.id} attempt ${attemptNumber}/${maxAttempts} failed:`, err);

      // Check if more retries available
      if (attemptNumber < maxAttempts) {
        // Calculate exponential backoff delay
        const delayMs = Math.pow(2, attemptNumber - 1) * 1000;
        console.log(`[cron] Task ${task.id} will retry in ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // No more retries: fail the task permanently
      const nextRunAt = computeNextRunAt(task);

      // Build failure notification with retry info
      const taskName = task.name ? ` "${task.name}"` : "";
      const failureMessage = `Tarea${taskName} falló después de ${attemptNumber} intentos: ${lastError}`;
      const { notified, reason } = await notifyUserViaTelegram(db, task.user_id, failureMessage);

      await failTaskRun(db, {
        runId: run.id,
        taskId: task.id,
        errorMessage: lastError,
        nextRunAt,
      });

      // Exit after permanent failure
      return;
    }
  }
}

function buildNotificationText(task: ScheduledTask, response: string): string {
  const scheduleLabel =
    task.schedule_type === "recurring" ? `[Tarea recurrente]` : `[Tarea programada]`;

  const preview = response.length > 2000 ? `${response.slice(0, 2000)}…` : response;

  return `${scheduleLabel}\n\n${preview}`;
}
