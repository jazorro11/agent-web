import { test } from "node:test";
import assert from "node:assert";
import { getChips } from "../chip-suggestions";

// ---------------------------------------------------------------------------
// Empty / fallback behaviour
// ---------------------------------------------------------------------------

test("getChips: empty tools array returns only the fixed fallback chip", () => {
  const chips = getChips([]);
  assert.equal(chips.length, 1, "Exactly 1 chip expected (fallback only)");
  assert.equal(chips[0].label, "¿Qué puedes hacer?");
  assert.equal(chips[0].message, "¿Qué puedes hacer?");
});

test("getChips: fixed fallback chip is always the last element", () => {
  const chips = getChips(["github_list_repos", "google_calendar_list_events", "notion_search"]);
  const last = chips[chips.length - 1];
  assert.equal(last.label, "¿Qué puedes hacer?");
});

// ---------------------------------------------------------------------------
// Dynamic chips — one per integration family
// ---------------------------------------------------------------------------

test("getChips: github_list_repos triggers GitHub chip", () => {
  const chips = getChips(["github_list_repos"]);
  const labels = chips.map((c) => c.label);
  assert.ok(labels.includes("Lista mis repositorios"), "GitHub chip must be present");
});

test("getChips: github_list_issues also triggers GitHub chip", () => {
  const chips = getChips(["github_list_issues"]);
  const labels = chips.map((c) => c.label);
  assert.ok(labels.includes("Lista mis repositorios"), "GitHub chip must be present via github_list_issues");
});

test("getChips: google_calendar_list_events triggers Calendar chip", () => {
  const chips = getChips(["google_calendar_list_events"]);
  const labels = chips.map((c) => c.label);
  assert.ok(labels.includes("Eventos de esta semana"), "Calendar chip must be present");
});

test("getChips: notion_search triggers Notion chip", () => {
  const chips = getChips(["notion_search"]);
  const labels = chips.map((c) => c.label);
  assert.ok(labels.includes("Busca en Notion"), "Notion chip must be present");
});

test("getChips: notion_get_page also triggers Notion chip", () => {
  const chips = getChips(["notion_get_page"]);
  const labels = chips.map((c) => c.label);
  assert.ok(labels.includes("Busca en Notion"), "Notion chip must be present via notion_get_page");
});

test("getChips: read_file triggers Files chip", () => {
  const chips = getChips(["read_file"]);
  const labels = chips.map((c) => c.label);
  assert.ok(labels.includes("Lee un archivo"), "Files chip must be present");
});

// ---------------------------------------------------------------------------
// Dynamic chips count cap — max 3 dynamic + 1 fixed
// ---------------------------------------------------------------------------

test("getChips: at most 3 dynamic chips even when all 4 families are present", () => {
  const tools = [
    "github_list_repos",
    "google_calendar_list_events",
    "notion_search",
    "read_file",
  ];
  const chips = getChips(tools);
  assert.equal(chips.length, 4, "3 dynamic + 1 fixed = 4 chips total");

  // The fourth one is the fixed chip
  assert.equal(chips[chips.length - 1].label, "¿Qué puedes hacer?");
  // read_file chip (4th family) must be absent — it was sliced off
  const labels = chips.map((c) => c.label);
  assert.ok(!labels.includes("Lee un archivo"), "Files chip must be dropped to respect 3-dynamic cap");
});

// ---------------------------------------------------------------------------
// Chip messages match labels intent
// ---------------------------------------------------------------------------

test("getChips: GitHub chip sends the right message", () => {
  const chips = getChips(["github_list_repos"]);
  const github = chips.find((c) => c.label === "Lista mis repositorios");
  assert.ok(github, "GitHub chip must exist");
  assert.equal(github!.message, "Lista mis repositorios");
});

test("getChips: Calendar chip sends the right message", () => {
  const chips = getChips(["google_calendar_list_events"]);
  const cal = chips.find((c) => c.label === "Eventos de esta semana");
  assert.ok(cal, "Calendar chip must exist");
  assert.equal(cal!.message, "Muestra mis eventos de esta semana");
});

test("getChips: unknown tool IDs do not produce unexpected chips", () => {
  const chips = getChips(["nonexistent_tool_xyz", "another_fake"]);
  assert.equal(chips.length, 1, "Only the fallback chip must appear for unknown tools");
  assert.equal(chips[0].label, "¿Qué puedes hacer?");
});
