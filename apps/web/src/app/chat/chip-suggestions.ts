/**
 * Generates suggestion chips for the chat empty state based on the user's
 * enabled tools. Returns up to 3 dynamic chips (one per integration category
 * present) plus one fixed fallback chip.
 *
 * Pure utility — no React dependencies. Extracted here so it can be unit-tested
 * independently of the chat component.
 */
export function getChips(tools: string[]): Array<{ label: string; message: string }> {
  const dynamic: Array<{ label: string; message: string }> = [];

  if (tools.includes("github_list_repos") || tools.includes("github_list_issues")) {
    dynamic.push({ label: "Lista mis repositorios", message: "Lista mis repositorios" });
  }
  if (
    tools.includes("google_calendar_list_events") ||
    tools.includes("google_calendar_list_calendars")
  ) {
    dynamic.push({
      label: "Eventos de esta semana",
      message: "Muestra mis eventos de esta semana",
    });
  }
  if (tools.includes("notion_search") || tools.includes("notion_get_page")) {
    dynamic.push({ label: "Busca en Notion", message: "Busca mis notas recientes en Notion" });
  }
  if (tools.includes("read_file")) {
    dynamic.push({ label: "Lee un archivo", message: "Lee el archivo README.md" });
  }

  return [
    ...dynamic.slice(0, 3),
    { label: "¿Qué puedes hacer?", message: "¿Qué puedes hacer?" },
  ];
}
