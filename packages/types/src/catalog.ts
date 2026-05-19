import type { ToolDefinition, ToolRisk } from "./index";

export const TOOL_CATALOG: ToolDefinition[] = [
  {
    id: "get_user_preferences",
    name: "get_user_preferences",
    description: "Returns the current user preferences and agent configuration.",
    risk: "low",
    parameters_schema: { type: "object", properties: {}, required: [] },
    displayName: "Preferencias del usuario",
    displayDescription: "Consulta tu configuración y preferencias.",
  },
  {
    id: "list_enabled_tools",
    name: "list_enabled_tools",
    description: "Lists all tools the user has currently enabled.",
    risk: "low",
    parameters_schema: { type: "object", properties: {}, required: [] },
    displayName: "Listar herramientas",
    displayDescription: "Muestra qué herramientas tienes habilitadas.",
  },
  {
    id: "github_list_repos",
    name: "github_list_repos",
    description: "Lists the user's GitHub repositories.",
    risk: "low",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        per_page: { type: "number", description: "Results per page (max 30)" },
      },
      required: [],
    },
    displayName: "GitHub: listar repos",
    displayDescription: "Lista tus repositorios de GitHub.",
  },
  {
    id: "github_list_issues",
    name: "github_list_issues",
    description: "Lists issues for a given repository.",
    risk: "low",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"] },
      },
      required: ["owner", "repo"],
    },
    displayName: "GitHub: listar issues",
    displayDescription: "Lista issues de un repositorio.",
  },
  {
    id: "github_create_issue",
    name: "github_create_issue",
    description: "Creates a new issue in a GitHub repository. Requires confirmation.",
    risk: "medium",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["owner", "repo", "title"],
    },
    displayName: "GitHub: crear issue",
    displayDescription: "Crea un issue nuevo (requiere confirmación).",
  },
  {
    id: "github_create_repo",
    name: "github_create_repo",
    description: "Creates a new GitHub repository for the authenticated user. Requires confirmation.",
    risk: "medium",
    requires_integration: "github",
    parameters_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Repository name" },
        description: { type: "string", description: "Repository description" },
        isPrivate: { type: "boolean", description: "Whether the repository is private" },
      },
      required: ["name"],
    },
    displayName: "GitHub: crear repositorio",
    displayDescription: "Crea un repositorio nuevo en GitHub (requiere confirmación).",
  },
  {
    id: "google_calendar_list_calendars",
    name: "google_calendar_list_calendars",
    description: "Lists the user's Google calendars (calendar list).",
    risk: "low",
    requires_integration: "google",
    parameters_schema: { type: "object", properties: {}, required: [] },
    displayName: "Google Calendar: listar calendarios",
    displayDescription: "Lista tus calendarios de Google.",
  },
  {
    id: "google_calendar_list_events",
    name: "google_calendar_list_events",
    description: "Lists events in a Google Calendar within an optional time range.",
    risk: "low",
    requires_integration: "google",
    parameters_schema: {
      type: "object",
      properties: {
        calendarId: { type: "string", description: "Calendar ID or omit for primary" },
        timeMin: { type: "string", description: "RFC3339 lower bound" },
        timeMax: { type: "string", description: "RFC3339 upper bound" },
        q: { type: "string", description: "Free text search" },
        maxResults: { type: "number", description: "Max events (default 50, max 2500)" },
      },
      required: [],
    },
    displayName: "Google Calendar: listar eventos",
    displayDescription: "Lista eventos de un calendario (rango de fechas opcional).",
  },
  {
    id: "google_calendar_create_event",
    name: "google_calendar_create_event",
    description: "Creates a calendar event. Requires confirmation.",
    risk: "medium",
    requires_integration: "google",
    parameters_schema: {
      type: "object",
      properties: {
        calendarId: { type: "string" },
        summary: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        start: {
          type: "object",
          properties: {
            dateTime: { type: "string" },
            timeZone: { type: "string" },
          },
          required: ["dateTime"],
        },
        end: {
          type: "object",
          properties: {
            dateTime: { type: "string" },
            timeZone: { type: "string" },
          },
          required: ["dateTime"],
        },
        attendees: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "start", "end"],
    },
    displayName: "Google Calendar: crear evento",
    displayDescription: "Crea un evento (requiere confirmación).",
  },
  {
    id: "google_calendar_update_event",
    name: "google_calendar_update_event",
    description: "Updates an existing calendar event. Requires confirmation.",
    risk: "medium",
    requires_integration: "google",
    parameters_schema: {
      type: "object",
      properties: {
        calendarId: { type: "string" },
        eventId: { type: "string" },
        summary: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        start: {
          type: "object",
          properties: {
            dateTime: { type: "string" },
            timeZone: { type: "string" },
          },
          required: ["dateTime"],
        },
        end: {
          type: "object",
          properties: {
            dateTime: { type: "string" },
            timeZone: { type: "string" },
          },
          required: ["dateTime"],
        },
        attendees: { type: "array", items: { type: "string" } },
      },
      required: ["eventId"],
    },
    displayName: "Google Calendar: actualizar evento",
    displayDescription: "Modifica un evento existente (requiere confirmación).",
  },
  {
    id: "google_calendar_delete_event",
    name: "google_calendar_delete_event",
    description: "Deletes a calendar event permanently. Requires confirmation.",
    risk: "medium",
    requires_integration: "google",
    parameters_schema: {
      type: "object",
      properties: {
        calendarId: { type: "string" },
        eventId: { type: "string" },
      },
      required: ["eventId"],
    },
    displayName: "Google Calendar: eliminar evento",
    displayDescription: "Elimina un evento (requiere confirmación).",
  },
  {
    id: "read_file",
    name: "read_file",
    description:
      "Reads an existing text file from the server filesystem. Use this when you need to inspect source code, config, logs, or any UTF-8 text without changing it. Do NOT use this to create or modify files; use write_file or edit_file instead. Do NOT use this if you only need a directory listing — this tool does not list folders. Parameters: `path` can be absolute or relative (resolved from the server process working directory, same as the bash tool). Optional `offset` is the 1-based start line number (first line is 1). Optional `limit` is the maximum number of lines to return starting at `offset`. If both are omitted, the full file is returned up to a server-enforced maximum. Binary files are not supported. Process: resolve path → read from disk → slice by line range if requested → return JSON. Success: { ok: true, path, content, startLine, endLine, totalLines }. Failure: { ok: false, path, error: { code, message } } with explicit reason (e.g. file not found, file too large, tool disabled).",
    risk: "low",
    parameters_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path or path relative to the server process working directory." },
        offset: { type: "number", description: "1-based line number to start reading from. Defaults to 1." },
        limit: { type: "number", description: "Maximum number of lines to return starting at offset." },
      },
      required: ["path"],
    },
    displayName: "Leer archivo",
    displayDescription: "Lee un archivo de texto existente dentro del workspace (opcionalmente por rango de líneas). No crea ni modifica archivos.",
  },
  {
    id: "write_file",
    name: "write_file",
    description:
      "Creates a NEW file with the given UTF-8 content. Use this ONLY when the file does not exist yet. If the file already exists this tool FAILS by design — use edit_file to change existing files. Do not use this to overwrite or patch. Parameters: `path` can be absolute or relative (resolved from the server process working directory, same as the bash tool); `content` is the full file body to write. Process: resolve path → verify file does not already exist → create parent directories → write atomically → return JSON. Success: { ok: true, path, bytesWritten }. Failure: { ok: false, path, error: { code, message } } e.g. file already exists, permission denied, or tool disabled. Human approval required before execution.",
    risk: "high",
    parameters_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path or path relative to the server process working directory. The file must not exist yet." },
        content: { type: "string", description: "Full UTF-8 content to write into the new file." },
      },
      required: ["path", "content"],
    },
    displayName: "Crear archivo",
    displayDescription: "Crea un archivo nuevo con contenido completo. Falla si el archivo ya existe; para cambios usa editar archivo.",
  },
  {
    id: "edit_file",
    name: "edit_file",
    description:
      "Edits an EXISTING UTF-8 text file by replacing EXACTLY ONE occurrence of old_string with new_string. Use this when you need to update part of a file without rewriting the whole file. Do NOT use this to create a new file (use write_file). If old_string might match zero or multiple places, add more surrounding context to make it unique. old_string and new_string are literal substrings, not regex. Line endings must match those in the file. Parameters: `path` can be absolute or relative (resolved from the server process working directory, same as the bash tool). Process: resolve path → read file → count occurrences of old_string → if not exactly 1, fail with a clear message (0 found vs N found) → apply replacement → write safely → return JSON. Success: { ok: true, path, replacements: 1 }. Failure: { ok: false, path, error: { code, message } } e.g. file not found, old_string found 0 times, old_string found N>1 times, permission denied, or tool disabled. Human approval required before execution.",
    risk: "high",
    parameters_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path or path relative to the server process working directory. The file must already exist." },
        old_string: { type: "string", description: "Literal substring to find. Must appear exactly once in the file." },
        new_string: { type: "string", description: "Literal string that replaces the single occurrence of old_string." },
      },
      required: ["path", "old_string", "new_string"],
    },
    displayName: "Editar archivo",
    displayDescription: "Reemplaza una única aparición de un fragmento en un archivo existente. No crea archivos nuevos.",
  },
  {
    id: "schedule_task",
    name: "schedule_task",
    description:
      "Creates a scheduled task that will run a given prompt automatically at a specified time or on a recurring cron schedule. For a one-time task provide run_at (ISO 8601 datetime). For a recurring task provide cron_expr (standard 5-field cron expression, e.g. '0 9 * * 1' for every Monday at 9 AM) and optionally timezone (IANA tz, defaults to user timezone). The task will trigger the agent with the given prompt and send the result via Telegram by default. Requires confirmation.",
    risk: "medium",
    parameters_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The instruction/prompt the agent will execute when the task fires.",
        },
        schedule_type: {
          type: "string",
          enum: ["one_time", "recurring"],
          description: "Whether this is a single execution or a recurring one.",
        },
        run_at: {
          type: "string",
          description: "ISO 8601 datetime for one_time tasks (e.g. '2026-04-10T09:00:00Z').",
        },
        cron_expr: {
          type: "string",
          description:
            "5-field cron expression for recurring tasks (e.g. '0 9 * * 1' = every Monday 9 AM).",
        },
        timezone: {
          type: "string",
          description: "IANA timezone name (e.g. 'America/Bogota'). Defaults to user timezone.",
        },
      },
      required: ["prompt", "schedule_type"],
    },
    displayName: "Programar tarea",
    displayDescription:
      "Crea una tarea programada que el agente ejecutará automáticamente y notificará por Telegram.",
  },
  {
    id: "bash",
    name: "bash",
    description:
      "Use this tool when you need to execute shell commands and interact with the operating system. On Windows the shell is PowerShell (powershell.exe -NonInteractive); on Linux/macOS the shell is bash. Commands are executed non-interactively and their text output is returned. High-risk commands (disk formatting, recursive deletion of system paths, download-and-execute pipelines) are blocked.",
    risk: "high",
    parameters_schema: {
      type: "object",
      properties: {
        terminal: { type: "string", description: "Terminal identifier for correlation and logging" },
        prompt: { type: "string", description: "Bash command to execute" },
      },
      required: ["terminal", "prompt"],
    },
    displayName: "Bash",
    displayDescription: "Ejecuta comandos bash en el servidor (riesgo alto, requiere confirmación).",
  },
  {
    id: "notion_search",
    name: "notion_search",
    description: "Search pages and databases in the user's Notion workspace by keyword.",
    risk: "low",
    requires_integration: "notion",
    parameters_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        filter: {
          type: "string",
          enum: ["page", "database"],
          description: "Optionally restrict results to pages or databases only",
        },
      },
      required: ["query"],
    },
    displayName: "Notion: buscar",
    displayDescription: "Busca páginas y bases de datos en tu workspace de Notion.",
  },
  {
    id: "notion_get_page",
    name: "notion_get_page",
    description: "Get the content and properties of a Notion page by its ID or URL.",
    risk: "low",
    requires_integration: "notion",
    parameters_schema: {
      type: "object",
      properties: {
        page_id: {
          type: "string",
          description: "Notion page ID (UUID) or full page URL",
        },
      },
      required: ["page_id"],
    },
    displayName: "Notion: leer página",
    displayDescription: "Lee el contenido y propiedades de una página de Notion.",
  },
  {
    id: "notion_create_page",
    name: "notion_create_page",
    description:
      "Create a new Notion page inside an existing page or database. Requires confirmation.",
    risk: "medium",
    requires_integration: "notion",
    parameters_schema: {
      type: "object",
      properties: {
        parent_id: {
          type: "string",
          description: "ID of the parent page or database where the new page will be created",
        },
        parent_type: {
          type: "string",
          enum: ["page", "database"],
          description: "Whether the parent is a page or a database (default: page)",
        },
        title: { type: "string", description: "Title of the new page" },
        content: {
          type: "string",
          description: "Optional body text for the first paragraph of the new page",
        },
      },
      required: ["parent_id", "title"],
    },
    displayName: "Notion: crear página",
    displayDescription:
      "Crea una página nueva en Notion dentro de una página o base de datos (requiere confirmación).",
  },
];

export function getToolRisk(toolId: string): ToolRisk {
  return TOOL_CATALOG.find((t) => t.id === toolId)?.risk ?? "high";
}

export function toolRequiresConfirmation(toolId: string): boolean {
  const risk = getToolRisk(toolId);
  return risk === "medium" || risk === "high";
}
