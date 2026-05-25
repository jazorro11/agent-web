"use client";

import { TOOL_CATALOG } from "@agents/types";
import type { OnboardingData } from "../wizard";

interface Props {
  data: OnboardingData;
  onChange: (partial: Partial<OnboardingData>) => void;
  isDemoUser?: boolean;
}

const RISK_LABELS = {
  low: { text: "Bajo", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  medium: { text: "Medio", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  high: { text: "Alto", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

export function StepTools({ data, onChange, isDemoUser = false }: Props) {
  const visibleTools = isDemoUser
    ? TOOL_CATALOG.filter((t) => t.risk === "low")
    : TOOL_CATALOG;

  function toggleTool(toolId: string) {
    const enabled = data.enabledTools.includes(toolId);
    onChange({
      enabledTools: enabled
        ? data.enabledTools.filter((id) => id !== toolId)
        : [...data.enabledTools, toolId],
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Herramientas</h2>
        <p className="text-sm text-neutral-500">
          Elige qué herramientas puede usar tu agente. Las de riesgo medio o
          alto pedirán confirmación antes de ejecutar.
        </p>
      </div>

      {isDemoUser && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          En modo demo solo están disponibles las herramientas de lectura (riesgo bajo).
          Regístrate para desbloquear todas las herramientas.
        </div>
      )}

      <div className="space-y-3">
        {visibleTools.map((t) => {
          const risk = RISK_LABELS[t.risk];
          const enabled = data.enabledTools.includes(t.id);
          return (
            <label
              key={t.id}
              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${
                enabled
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                  : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700"
              }`}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={() => toggleTool(t.id)}
                className="mt-0.5 rounded border-neutral-300"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.displayName}</span>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${risk.color}`}>
                    {risk.text}
                  </span>
                  {t.requires_integration && (
                    <span className="text-xs text-neutral-400">
                      requiere {t.requires_integration}
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {t.displayDescription}
                </p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
