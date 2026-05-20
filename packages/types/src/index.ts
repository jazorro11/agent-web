export * from "./catalog";

export type Channel = "web" | "telegram";

export type ToolRisk = "low" | "medium" | "high";

export interface Profile {
  id: string;
  name: string;
  timezone: string;
  language: string;
  agent_name: string;
  agent_system_prompt: string;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserIntegration {
  id: string;
  user_id: string;
  provider: string;
  scopes: string[];
  status: "active" | "revoked" | "expired";
  created_at: string;
  /** ISO timestamp when the OAuth access token expires (Google); null if N/A */
  expires_at?: string | null;
}

export interface UserToolSetting {
  id: string;
  user_id: string;
  tool_id: string;
  enabled: boolean;
  config_json: Record<string, unknown>;
}

export interface AgentSession {
  id: string;
  user_id: string;
  channel: Channel;
  status: "active" | "closed";
  budget_tokens_used: number;
  budget_tokens_limit: number;
  last_used_at: string;
  created_at: string;
  updated_at: string;
}

export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface AgentMessage {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  tool_call_id?: string;
  structured_payload?: Record<string, unknown>;
  created_at: string;
}

export interface ToolCall {
  id: string;
  session_id: string;
  tool_name: string;
  arguments_json: Record<string, unknown>;
  result_json?: Record<string, unknown>;
  status: "pending_confirmation" | "approved" | "rejected" | "executed" | "failed";
  requires_confirmation: boolean;
  created_at: string;
  finished_at?: string;
}

export interface TelegramAccount {
  id: string;
  user_id: string;
  telegram_user_id: number;
  chat_id: number;
  linked_at: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  risk: ToolRisk;
  requires_integration?: string;
  parameters_schema: Record<string, unknown>;
  displayName: string;
  displayDescription: string;
}

export interface PendingConfirmation {
  /** Stable discriminator for UI and APIs — never infer approval from `message` alone. */
  kind: "human_approval";
  tool_call_id: string;
  tool_name: string;
  message: string;
  args: Record<string, unknown>;
}

export type ScheduleType = "one_time" | "recurring";
export type ScheduledTaskStatus = "active" | "paused" | "completed" | "failed";

export interface ScheduledTask {
  id: string;
  user_id: string;
  prompt: string;
  schedule_type: ScheduleType;
  run_at?: string;
  cron_expr?: string;
  timezone: string;
  status: ScheduledTaskStatus;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
  updated_at: string;
  name: string;
  description?: string;
  tags: string[];
  priority: "low" | "medium" | "high";
  max_retries: number;
}

export type TaskRunStatus = "running" | "completed" | "failed";

export interface ScheduledTaskRun {
  id: string;
  task_id: string;
  status: TaskRunStatus;
  started_at: string;
  finished_at?: string;
  error?: string;
  agent_session_id?: string;
  notified: boolean;
  notification_error?: string;
  attempt_number: number;
  retry_count: number;
  retry_reason?: string;
}
