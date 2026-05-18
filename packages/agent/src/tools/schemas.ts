import { z } from "zod";

export const TOOL_SCHEMAS = {
  get_user_preferences: z.object({}),
  list_enabled_tools: z.object({}),
  github_list_repos: z.object({
    per_page: z.number().max(30).optional().default(10),
  }),
  github_list_issues: z.object({
    owner: z.string(),
    repo: z.string(),
    state: z.enum(["open", "closed", "all"]).optional().default("open"),
  }),
  github_create_issue: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    body: z.string().optional().default(""),
  }),
  github_create_repo: z.object({
    name: z.string(),
    description: z.string().optional().default(""),
    isPrivate: z.boolean().optional().default(false),
  }),
  google_calendar_list_calendars: z.object({}),
  google_calendar_list_events: z.object({
    calendarId: z.string().optional(),
    timeMin: z.string().optional(),
    timeMax: z.string().optional(),
    q: z.string().optional(),
    maxResults: z.number().int().min(1).max(2500).optional(),
  }),
  google_calendar_create_event: z.object({
    calendarId: z.string().optional(),
    summary: z.string().min(1),
    description: z.string().optional(),
    location: z.string().optional(),
    start: z.object({
      dateTime: z.string(),
      timeZone: z.string().optional(),
    }),
    end: z.object({
      dateTime: z.string(),
      timeZone: z.string().optional(),
    }),
    attendees: z.array(z.string().email()).optional(),
  }),
  google_calendar_update_event: z
    .object({
      calendarId: z.string().optional(),
      eventId: z.string().min(1),
      summary: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      start: z
        .object({
          dateTime: z.string(),
          timeZone: z.string().optional(),
        })
        .optional(),
      end: z
        .object({
          dateTime: z.string(),
          timeZone: z.string().optional(),
        })
        .optional(),
      attendees: z.array(z.string().email()).optional(),
    })
    .refine(
      (d) =>
        d.summary !== undefined ||
        d.description !== undefined ||
        d.location !== undefined ||
        d.start !== undefined ||
        d.end !== undefined ||
        d.attendees !== undefined,
      { message: "Provide at least one field to update besides eventId." }
    ),
  google_calendar_delete_event: z.object({
    calendarId: z.string().optional(),
    eventId: z.string().min(1),
  }),
  read_file: z.object({
    path: z.string().describe("Absolute path or path relative to the server process working directory."),
    offset: z.number().int().min(1).optional().describe("1-based line number to start reading from. Defaults to 1."),
    limit: z.number().int().min(1).optional().describe("Maximum number of lines to return starting at offset."),
  }),
  write_file: z.object({
    path: z.string().describe("Absolute path or path relative to the server process working directory. The file must NOT exist yet."),
    content: z.string().max(500_000).describe("Full UTF-8 content to write into the new file."),
  }),
  edit_file: z.object({
    path: z.string().describe("Absolute path or path relative to the server process working directory. The file must already exist."),
    old_string: z.string().describe("Literal substring to find. Must appear exactly once in the file."),
    new_string: z.string().describe("Literal string that replaces the single occurrence of old_string."),
  }),
  bash: z.object({
    terminal: z.string().describe("Terminal identifier for correlation and logging"),
    prompt: z.string().max(4096).describe("Bash command to execute"),
  }),
  schedule_task: z
    .object({
      prompt: z.string().min(1).describe("The instruction the agent will run when the task fires."),
      schedule_type: z
        .enum(["one_time", "recurring"])
        .describe("Whether this is a single execution or a recurring one."),
      run_at: z
        .string()
        .optional()
        .describe("ISO 8601 datetime for one_time tasks (e.g. '2026-04-10T09:00:00Z')."),
      cron_expr: z
        .string()
        .optional()
        .describe(
          "5-field cron expression for recurring tasks (e.g. '0 9 * * 1' = every Monday 9 AM)."
        ),
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone name (e.g. 'America/Bogota'). Defaults to user timezone."),
    })
    .refine(
      (data) => {
        if (data.schedule_type === "one_time") return !!data.run_at;
        if (data.schedule_type === "recurring") return !!data.cron_expr;
        return false;
      },
      {
        message:
          "one_time tasks require run_at; recurring tasks require cron_expr.",
      }
    ),
  notion_search: z.object({
    query: z.string().min(1),
    filter: z.enum(["page", "database"]).optional(),
  }),
  notion_get_page: z.object({
    page_id: z.string().min(1).describe("Notion page ID (UUID) or full page URL"),
  }),
  notion_create_page: z.object({
    parent_id: z.string().min(1),
    parent_type: z.enum(["page", "database"]).optional().default("page"),
    title: z.string().min(1),
    content: z.string().optional(),
  }),
} as const;

export type ToolSchemas = typeof TOOL_SCHEMAS;
export type ToolId = keyof ToolSchemas;
