"use client";

import { TOOL_CATALOG } from "@agents/types";
import type { OnboardingData } from "../wizard";

interface Props {
  data: OnboardingData;
  onChange: (partial: Partial<OnboardingData>) => void;
  isDemoUser?: boolean;
}

interface Category {
  id: string;
  label: string;
  icon: string;
  description: string;
  examples: string[];
  integration: string | null;
  toolIds: string[];
}

const CATEGORIES: Category[] = [
  {
    id: "github",
    label: "GitHub",
    icon: "⚙",
    description: "Consulta tus repositorios e issues directamente desde el chat.",
    examples: [
      "Lista mis repositorios públicos",
      "Muestra los issues abiertos de mi proyecto",
    ],
    integration: "github",
    toolIds: ["github_list_repos", "github_list_issues", "github_create_issue", "github_create_repo"],
  },
  {
    id: "google",
    label: "Google Calendar",
    icon: "📅",
    description: "Consulta y gestiona tu calendario desde el chat.",
    examples: [
      "Muestra mis eventos de esta semana",
      "Lista mis calendarios disponibles",
    ],
    integration: "google",
    toolIds: [
      "google_calendar_list_calendars",
      "google_calendar_list_events",
      "google_calendar_create_event",
      "google_calendar_update_event",
      "google_calendar_delete_event",
    ],
  },
  {
    id: "notion",
    label: "Notion",
    icon: "📝",
    description: "Busca y crea contenido en tu workspace de Notion.",
    examples: [
      "Busca notas sobre presupuesto",
      "Lee la página de OKRs del equipo",
    ],
    integration: "notion",
    toolIds: ["notion_search", "notion_get_page", "notion_create_page"],
  },
  {
    id: "archivos",
    label: "Archivos",
    icon: "📁",
    description: "Lee y modifica archivos de texto sin necesidad de integraciones.",
    examples: [
      "Lee el archivo README.md y resúmelo",
      "¿Qué dice el archivo config.json?",
    ],
    integration: null,
    toolIds: ["read_file", "write_file", "edit_file"],
  },
  {
    id: "utilidades",
    label: "Utilidades",
    icon: "✦",
    description: "Herramientas generales del agente.",
    examples: [
      "¿Qué herramientas tienes activas?",
      "¿Cuál es mi zona horaria configurada?",
    ],
    integration: null,
    toolIds: ["get_user_preferences", "list_enabled_tools", "schedule_task", "bash"],
  },
];

export function StepTools({ data, onChange, isDemoUser = false }: Props) {
  const visibleToolIds = new Set(
    isDemoUser
      ? TOOL_CATALOG.filter((t) => t.risk === "low").map((t) => t.id)
      : TOOL_CATALOG.map((t) => t.id)
  );

  function toggleTool(toolId: string) {
    const enabled = data.enabledTools.includes(toolId);
    onChange({
      enabledTools: enabled
        ? data.enabledTools.filter((id) => id !== toolId)
        : [...data.enabledTools, toolId],
    });
  }

  function getActiveCount(toolIds: string[]): number {
    return toolIds.filter(
      (id) => visibleToolIds.has(id) && data.enabledTools.includes(id)
    ).length;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Herramientas</h2>
        <p className="text-sm text-neutral-500">
          Activa las herramientas que quieres darle a tu agente. Las de riesgo
          medio o alto pedirán confirmación antes de ejecutar.
        </p>
      </div>

      <div className="space-y-4">
        {CATEGORIES.map((cat) => {
          const activeCount = getActiveCount(cat.toolIds);
          const isIntegrationCategory = cat.integration !== null;
          const isDemoBlocked = isDemoUser && isIntegrationCategory;
          const categoryTools = cat.toolIds
            .map((id) => TOOL_CATALOG.find((t) => t.id === id))
            .filter((t): t is NonNullable<typeof t> => t != null)
            .filter((t) => visibleToolIds.has(t.id));
          const hiddenDemoTools =
            isDemoUser && !isDemoBlocked
              ? cat.toolIds
                  .map((id) => TOOL_CATALOG.find((t) => t.id === id))
                  .filter((t): t is NonNullable<typeof t> => t != null)
                  .filter((t) => !visibleToolIds.has(t.id))
              : [];

          return (
            <div
              key={cat.id}
              className={`rounded-lg border p-4 ${
                !isDemoBlocked && activeCount > 0
                  ? "border-blue-400 bg-blue-50 dark:bg-blue-950/20"
                  : "border-neutral-200 dark:border-neutral-800"
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{cat.icon}</span>
                  <span className="font-semibold text-sm">{cat.label}</span>
                </div>
                {isDemoBlocked ? (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
                    Requiere registro
                  </span>
                ) : (
                  activeCount > 0 && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      {activeCount} activa{activeCount !== 1 ? "s" : ""}
                    </span>
                  )
                )}
              </div>

              {/* Description */}
              <p className="text-xs text-neutral-500 mb-3">{cat.description}</p>

              {/* Examples */}
              <div className="rounded-md bg-neutral-50 px-3 py-2 mb-3 dark:bg-neutral-900">
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1">
                  Ejemplos
                </p>
                {cat.examples.map((ex) => (
                  <p key={ex} className="text-xs text-neutral-600 dark:text-neutral-400 mb-0.5">
                    &ldquo;{ex}&rdquo;
                  </p>
                ))}
              </div>

              {/* Integration notice */}
              {cat.integration && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                  {isDemoUser
                    ? `Conéctate con ${cat.label} al registrarte para usar estas herramientas.`
                    : `Requiere conectar ${cat.label} en Ajustes.`}
                </p>
              )}

              {/* Tool toggles */}
              {categoryTools.length > 0 && !isDemoBlocked && (
                <div className="space-y-1.5">
                  {categoryTools.map((t) => {
                    const riskColor =
                      t.risk === "low"
                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                        : t.risk === "medium"
                        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                        : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
                    const riskLabel =
                      t.risk === "low" ? "Bajo" : t.risk === "medium" ? "Medio" : "Alto";
                    const isChecked = data.enabledTools.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        className="flex items-center gap-2 cursor-pointer rounded-md p-1.5 hover:bg-white dark:hover:bg-neutral-800 transition"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleTool(t.id)}
                          className="rounded border-neutral-300"
                        />
                        <span className="flex-1 text-xs">{t.displayName}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${riskColor}`}>
                          {riskLabel}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Demo: show risk-locked tools as greyed out in non-integration categories */}
              {hiddenDemoTools.length > 0 && (
                <div className="mt-1.5 space-y-1.5 opacity-40 select-none">
                  {hiddenDemoTools.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 rounded-md p-1.5">
                      <input type="checkbox" disabled className="rounded border-neutral-300" />
                      <span className="flex-1 text-xs">{t.displayName}</span>
                      <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-400 dark:bg-neutral-800">
                        Requiere registro
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Demo: show locked tools as greyed out */}
              {isDemoBlocked && (
                <div className="space-y-1.5 opacity-40 select-none">
                  {cat.toolIds.map((id) => {
                    const t = TOOL_CATALOG.find((tool) => tool.id === id);
                    if (!t) return null;
                    return (
                      <div key={id} className="flex items-center gap-2 rounded-md p-1.5">
                        <input type="checkbox" disabled className="rounded border-neutral-300" />
                        <span className="flex-1 text-xs">{t.displayName}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
