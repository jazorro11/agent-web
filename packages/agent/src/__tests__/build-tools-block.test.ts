import { test } from "node:test";
import assert from "node:assert";
import type { UserToolSetting } from "@agents/types";
import { buildToolsBlock } from "../graph";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal UserToolSetting for a given tool ID. */
function setting(tool_id: string, enabled = true): UserToolSetting {
  return { id: `${tool_id}-id`, user_id: "user-1", tool_id, enabled, config_json: {} };
}

// ---------------------------------------------------------------------------
// Demo-user behaviour
// ---------------------------------------------------------------------------

test("buildToolsBlock: demo user always returns fixed demo block", () => {
  const result = buildToolsBlock([], /* isDemoUser */ true);
  assert.ok(
    result.includes("<herramientas_activas>"),
    "Result must open with <herramientas_activas>"
  );
  assert.ok(
    result.includes("</herramientas_activas>"),
    "Result must close with </herramientas_activas>"
  );
  assert.ok(
    result.includes("modo demo"),
    "Demo block must mention 'modo demo'"
  );
  assert.ok(
    result.includes("solo lectura"),
    "Demo block must mention read-only tools"
  );
});

test("buildToolsBlock: demo user block is the same regardless of enabled tools", () => {
  const withTools = buildToolsBlock(
    [setting("github_list_repos"), setting("read_file")],
    true
  );
  const withoutTools = buildToolsBlock([], true);
  assert.equal(withTools, withoutTools, "Demo block must be identical regardless of provided tools");
});

test("buildToolsBlock: demo block mentions GitHub, Google Calendar and Notion as upgrade benefits", () => {
  const result = buildToolsBlock([], true);
  assert.ok(result.includes("GitHub"), "Demo block must mention GitHub as an upgrade benefit");
  assert.ok(result.includes("Google Calendar"), "Demo block must mention Google Calendar as an upgrade benefit");
  assert.ok(result.includes("Notion"), "Demo block must mention Notion as an upgrade benefit");
});

// ---------------------------------------------------------------------------
// Registered user — empty / disabled tools
// ---------------------------------------------------------------------------

test("buildToolsBlock: no enabled tools returns empty string", () => {
  const result = buildToolsBlock([], false);
  assert.equal(result, "", "Empty tool list must produce an empty string");
});

test("buildToolsBlock: all disabled tools returns empty string", () => {
  const tools = [
    setting("github_list_repos", false),
    setting("read_file", false),
  ];
  const result = buildToolsBlock(tools, false);
  assert.equal(result, "", "All-disabled tools must produce an empty string");
});

test("buildToolsBlock: only enabled tools are included (mixed enabled/disabled)", () => {
  const tools = [
    setting("github_list_repos", true),
    setting("github_list_issues", false),  // disabled — must not appear
  ];
  const result = buildToolsBlock(tools, false);
  assert.ok(result.includes("GitHub: listar repos"), "Enabled tool display name must appear");
  assert.ok(!result.includes("listar issues"), "Disabled tool display name must not appear");
});

// ---------------------------------------------------------------------------
// Registered user — category grouping
// ---------------------------------------------------------------------------

test("buildToolsBlock: GitHub tools are grouped under 'GitHub'", () => {
  const tools = [
    setting("github_list_repos"),
    setting("github_list_issues"),
  ];
  const result = buildToolsBlock(tools, false);
  assert.ok(result.includes("GitHub:"), "GitHub category header must appear");
  assert.ok(result.includes("GitHub: listar repos"), "github_list_repos displayName must appear");
  assert.ok(result.includes("listar issues"), "github_list_issues displayName must appear");
  assert.ok(!result.includes("Google Calendar:"), "Google Calendar header must not appear");
});

test("buildToolsBlock: Google Calendar tools are grouped under 'Google Calendar'", () => {
  const tools = [
    setting("google_calendar_list_events"),
    setting("google_calendar_list_calendars"),
  ];
  const result = buildToolsBlock(tools, false);
  assert.ok(result.includes("Google Calendar:"), "Google Calendar category header must appear");
  assert.ok(!result.includes("GitHub:"), "GitHub header must not appear");
});

test("buildToolsBlock: Notion tools are grouped under 'Notion'", () => {
  const tools = [setting("notion_search"), setting("notion_get_page")];
  const result = buildToolsBlock(tools, false);
  assert.ok(result.includes("Notion:"), "Notion category header must appear");
  assert.ok(!result.includes("GitHub:"), "GitHub header must not appear");
});

test("buildToolsBlock: file tools (read_file / write_file / edit_file) are grouped under 'Archivos'", () => {
  const tools = [setting("read_file"), setting("write_file")];
  const result = buildToolsBlock(tools, false);
  assert.ok(result.includes("Archivos:"), "Archivos category header must appear");
  assert.ok(result.includes("Leer archivo"), "read_file displayName 'Leer archivo' must appear");
  assert.ok(result.includes("Crear archivo"), "write_file displayName 'Crear archivo' must appear");
});

test("buildToolsBlock: utility tools (get_user_preferences, list_enabled_tools, schedule_task, bash) are grouped under 'Utilidades'", () => {
  const tools = [
    setting("get_user_preferences"),
    setting("list_enabled_tools"),
    setting("schedule_task"),
  ];
  const result = buildToolsBlock(tools, false);
  assert.ok(result.includes("Utilidades:"), "Utilidades category header must appear");
});

test("buildToolsBlock: multiple categories are all present when tools from each are enabled", () => {
  const tools = [
    setting("github_list_repos"),
    setting("google_calendar_list_events"),
    setting("read_file"),
    setting("get_user_preferences"),
  ];
  const result = buildToolsBlock(tools, false);
  assert.ok(result.includes("GitHub:"), "GitHub header must appear");
  assert.ok(result.includes("Google Calendar:"), "Google Calendar header must appear");
  assert.ok(result.includes("Archivos:"), "Archivos header must appear");
  assert.ok(result.includes("Utilidades:"), "Utilidades header must appear");
});

// ---------------------------------------------------------------------------
// Registered user — output structure
// ---------------------------------------------------------------------------

test("buildToolsBlock: non-empty result is wrapped in <herramientas_activas> XML tags", () => {
  const result = buildToolsBlock([setting("read_file")], false);
  assert.ok(
    result.startsWith("<herramientas_activas>"),
    "Result must open with <herramientas_activas>"
  );
  assert.ok(
    result.trimEnd().endsWith("</herramientas_activas>"),
    "Result must close with </herramientas_activas>"
  );
});

test("buildToolsBlock: unknown tool IDs are silently ignored", () => {
  const tools = [
    setting("nonexistent_tool_xyz"),
    setting("read_file"),
  ];
  const result = buildToolsBlock(tools, false);
  // Should still produce output for the known tool
  assert.ok(result.includes("Leer archivo"), "Known tool must still appear");
  assert.ok(!result.includes("nonexistent"), "Unknown tool ID must not appear in output");
});
