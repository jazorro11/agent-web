import type { DbClient } from "../client";
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduleType,
  TaskRunStatus,
} from "@agents/types";

export async function createScheduledTask(
  db: DbClient,
  params: {
    userId: string;
    prompt: string;
    scheduleType: "one_time" | "recurring";
    runAt?: string;
    cronExpr?: string;
    timezone: string;
    nextRunAt: string;
    name: string;
    description?: string;
    tags?: string[];
    priority?: "low" | "medium" | "high";
    maxRetries?: number;
  }
): Promise<ScheduledTask> {
  const { data, error } = await db
    .from("scheduled_tasks")
    .insert({
      user_id: params.userId,
      prompt: params.prompt,
      schedule_type: params.scheduleType,
      run_at: params.runAt,
      cron_expr: params.cronExpr,
      timezone: params.timezone,
      next_run_at: params.nextRunAt,
      status: "active",
      name: params.name,
      description: params.description,
      tags: params.tags ?? [],
      priority: params.priority ?? "medium",
      max_retries: params.maxRetries ?? 0
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create scheduled task: ${error.message}`);
  }

  return data as ScheduledTask;
}

/**
 * Returns tasks due for execution (next_run_at <= now, status = active) and
 * atomically marks them as running by updating next_run_at to a future
 * sentinel so a concurrent invocation cannot pick the same row.
 *
 * The cron runner is responsible for recalculating the real next_run_at after
 * the execution finishes.
 */
export async function claimDueTasks(
  db: DbClient,
  limit = 20
): Promise<ScheduledTask[]> {
  const now = new Date().toISOString();

  // Read candidates first (service-role, no RLS restriction)
  const { data: candidates, error } = await db
    .from("scheduled_tasks")
    .select("*")
    .eq("status", "active")
    .lte("next_run_at", now)
    .order("priority", { ascending: false })
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  if (!candidates || candidates.length === 0) return [];

  // Optimistic claim: push next_run_at far into the future so parallel runners skip them.
  // Real value is set by completeTaskRun / failTaskRun.
  const sentinel = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
  const ids = (candidates as ScheduledTask[]).map((t) => t.id);

  await db
    .from("scheduled_tasks")
    .update({ next_run_at: sentinel, updated_at: now })
    .in("id", ids)
    .eq("status", "active"); // extra guard

  return candidates as ScheduledTask[];
}

export async function getScheduledTask(
  db: DbClient,
  taskId: string
): Promise<ScheduledTask | null> {
  const { data } = await db
    .from("scheduled_tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  return data as ScheduledTask | null;
}

export async function listScheduledTasksByUser(
  db: DbClient,
  userId: string
): Promise<ScheduledTask[]> {
  const { data, error } = await db
    .from("scheduled_tasks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ScheduledTask[];
}

export async function createTaskRun(
  db: DbClient,
  params: {
    taskId: string;
    agentSessionId?: string;
    attemptNumber?: number;
    retryCount?: number;
    retryReason?: string;
  }
): Promise<ScheduledTaskRun> {
  const { data, error } = await db
    .from("scheduled_task_runs")
    .insert({
      task_id: params.taskId,
      agent_session_id: params.agentSessionId,
      status: "running",
      started_at: new Date().toISOString(),
      notified: false,
      attempt_number: params.attemptNumber ?? 1,
      retry_count: params.retryCount ?? 0,
      retry_reason: params.retryReason
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create task run: ${error.message}`);
  }

  return data as ScheduledTaskRun;
}

export async function completeTaskRun(
  db: DbClient,
  params: {
    runId: string;
    taskId: string;
    agentSessionId?: string;
    nextRunAt: string | null;
    newStatus: "completed" | "active";
    notified: boolean;
    notificationError?: string;
  }
): Promise<void> {
  const now = new Date().toISOString();

  await db
    .from("scheduled_task_runs")
    .update({
      status: "completed" as TaskRunStatus,
      finished_at: now,
      agent_session_id: params.agentSessionId ?? null,
      notified: params.notified,
      notification_error: params.notificationError ?? null,
    })
    .eq("id", params.runId);

  await db
    .from("scheduled_tasks")
    .update({
      status: params.newStatus,
      last_run_at: now,
      next_run_at: params.nextRunAt,
      updated_at: now,
    })
    .eq("id", params.taskId);
}

export async function failTaskRun(
  db: DbClient,
  params: {
    runId: string;
    taskId: string;
    errorMessage: string;
    nextRunAt: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();

  await db
    .from("scheduled_task_runs")
    .update({
      status: "failed" as TaskRunStatus,
      finished_at: now,
      error: params.errorMessage,
    })
    .eq("id", params.runId);

  await db
    .from("scheduled_tasks")
    .update({
      last_run_at: now,
      next_run_at: params.nextRunAt,
      updated_at: now,
    })
    .eq("id", params.taskId);
}

export async function searchTasksByTag(
  db: DbClient,
  userId: string,
  tag: string
): Promise<ScheduledTask[]> {
  const { data, error } = await db
    .from("scheduled_tasks")
    .select("*")
    .eq("user_id", userId)
    .contains("tags", [tag])
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to search tasks by tag: ${error.message}`);
  }

  return (data || []) as ScheduledTask[];
}
