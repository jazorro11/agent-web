# Demo Onboarding Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mejorar el onboarding del demo para que el usuario entienda las capacidades del agente, con tarjetas de herramientas por categoría en el wizard, chips de sugerencia en el chat vacío, system prompt enriquecido con las herramientas activas, y textos corregidos (sin guiones largos ni flechas).

**Architecture:** Cuatro cambios independientes sobre componentes existentes: (1) rediseño visual de `step-tools.tsx` con tarjetas por categoría; (2) chips clicables en el estado vacío de `chat-interface.tsx`; (3) función `buildToolsBlock` en `graph.ts` que inyecta herramientas activas al system prompt con texto diferente para demo vs. usuario registrado; (4) correcciones de copy en cinco archivos.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, LangGraph JS, `@agents/types` (TOOL_CATALOG), `@agents/db`.

---

## Mapa de archivos

| Archivo | Acción | Qué cambia |
|---|---|---|
| `apps/web/src/app/chat/page.tsx` | Modificar | Texto del banner demo, query de enabled tools, prop a ChatInterface |
| `apps/web/src/app/login/page.tsx` | Modificar | Texto del botón demo |
| `apps/web/src/app/settings/settings-form.tsx` | Modificar | Formato de nombre y descripción de herramientas, texto de enlace demo |
| `apps/web/src/app/chat/chat-interface.tsx` | Modificar | Saludo vacío reemplazado por chips de sugerencia, prop enabledTools |
| `packages/agent/src/graph.ts` | Modificar | Añadir isDemoUser a AgentInput, función buildToolsBlock, inyección en system prompt |
| `apps/web/src/app/api/chat/route.ts` | Modificar | Pasar isDemoUser a runAgent |
| `apps/web/src/app/onboarding/steps/step-tools.tsx` | Reescribir | Tarjetas por categoría con ejemplos de prompts |

---

## Task 1: Correcciones de texto

**Files:**
- Modify: `apps/web/src/app/chat/page.tsx`
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/app/settings/settings-form.tsx`
- Modify: `apps/web/src/app/chat/chat-interface.tsx`

- [ ] **Step 1.1: Corregir banner demo en chat/page.tsx**

En `apps/web/src/app/chat/page.tsx` (líneas 113-123), reemplazar:

```tsx
{isDemoUser && (
  <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
    <span>Estás probando el demo — solo herramientas de lectura disponibles.</span>
    <a
      href="/api/auth/demo-exit"
      className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
    >
      Regístrate para acceso completo →
    </a>
  </div>
)}
```

Por:

```tsx
{isDemoUser && (
  <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
    <span>Estás probando el demo. Solo herramientas de lectura disponibles.</span>
    <a
      href="/api/auth/demo-exit"
      className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
    >
      Regístrate para acceso completo.
    </a>
  </div>
)}
```

- [ ] **Step 1.2: Corregir botón demo en login/page.tsx**

En `apps/web/src/app/login/page.tsx` (línea 32), reemplazar:

```tsx
          Ver demo en vivo →
```

Por:

```tsx
          Ver demo en vivo
```

- [ ] **Step 1.3: Corregir formato de herramientas y enlace en settings-form.tsx**

En `apps/web/src/app/settings/settings-form.tsx` (línea 273), reemplazar:

```tsx
                  <span className="text-neutral-500">— {displayDescription}</span>
```

Por:

```tsx
                  <span className="text-neutral-500">: {displayDescription}</span>
```

En la misma línea ~252 del banner demo en settings, reemplazar:

```tsx
            <a href="/signup" className="font-medium underline">
              Regístrate para acceso completo →
            </a>
```

Por:

```tsx
            <a href="/signup" className="font-medium underline">
              Regístrate para acceso completo.
            </a>
```

- [ ] **Step 1.4: Corregir saludo en chat-interface.tsx**

En `apps/web/src/app/chat/chat-interface.tsx` (líneas 403-410), reemplazar el bloque `messages.length === 0` completo:

```tsx
            {messages.length === 0 && (
              <div className="text-center text-sm text-neutral-400 py-20">
                <p className="text-lg font-medium text-neutral-600 dark:text-neutral-300">
                  {agentName ? `Hola! Soy ${agentName}` : "Hola!"}
                </p>
                <p className="mt-1">Escribe un mensaje para comenzar.</p>
              </div>
            )}
```

Por (texto corregido, los chips se añadirán en Task 3):

```tsx
            {messages.length === 0 && (
              <div className="text-center text-sm text-neutral-400 py-20">
                <p className="text-lg font-medium text-neutral-600 dark:text-neutral-300">
                  Hola, soy tu agente.
                </p>
                <p className="mt-1">Prueba alguna de estas acciones o escribe lo que necesitas.</p>
              </div>
            )}
```

- [ ] **Step 1.5: Verificar tipos**

```bash
npm run type-check -w @agents/web
```

Resultado esperado: sin errores de TypeScript.

- [ ] **Step 1.6: Commit**

```bash
git add apps/web/src/app/chat/page.tsx apps/web/src/app/login/page.tsx apps/web/src/app/settings/settings-form.tsx apps/web/src/app/chat/chat-interface.tsx
git -c skill.commit=true commit -m "fix(ui): eliminar guiones largos y flechas en textos de demo"
```

---

## Task 2: System prompt enriquecido con herramientas activas

**Files:**
- Modify: `packages/agent/src/graph.ts`
- Modify: `apps/web/src/app/api/chat/route.ts`

- [ ] **Step 2.1: Añadir isDemoUser a AgentInput**

En `packages/agent/src/graph.ts` (línea 54, al final de la interfaz `AgentInput`), añadir el campo antes del cierre de la interfaz:

```typescript
export interface AgentInput {
  message?: string;
  resumeDecision?: "approve" | "reject";
  userId: string;
  sessionId: string;
  systemPrompt: string;
  db: DbClient;
  enabledTools: UserToolSetting[];
  integrations: UserIntegration[];
  githubToken?: string;
  googleToken?: string;
  notionToken?: string;
  /** Skip HITL interrupts and auto-approve all tool calls. Use only for unattended runs (e.g. cron). */
  bypassConfirmation?: boolean;
  /** True when the caller is the shared demo account. Used to tailor the tools block in the system prompt. */
  isDemoUser?: boolean;
}
```

- [ ] **Step 2.2: Añadir función buildToolsBlock justo antes de la función buildConfirmationMessage**

En `packages/agent/src/graph.ts`, añadir esta función antes de `buildConfirmationMessage` (alrededor de línea 67):

```typescript
/** Builds the <herramientas_activas> block appended to the system prompt. */
function buildToolsBlock(enabledTools: UserToolSetting[], isDemoUser: boolean): string {
  if (isDemoUser) {
    return `<herramientas_activas>
Estás en modo demo. Tienes acceso a herramientas de solo lectura:

Archivos: leer archivos de texto.
Utilidades: ver preferencias del usuario, listar herramientas activas.

Con una cuenta completa puedes conectar GitHub, Google Calendar y Notion
para crear eventos, issues, páginas y ejecutar tareas programadas.
</herramientas_activas>`;
  }

  const activeIds = enabledTools.filter((t) => t.enabled).map((t) => t.tool_id);
  if (activeIds.length === 0) return "";

  const groups: Record<string, string[]> = {};
  for (const toolId of activeIds) {
    const def = TOOL_CATALOG.find((t) => t.id === toolId);
    if (!def) continue;
    let category: string;
    if (def.requires_integration === "github") category = "GitHub";
    else if (def.requires_integration === "google") category = "Google Calendar";
    else if (def.requires_integration === "notion") category = "Notion";
    else if (["read_file", "write_file", "edit_file"].includes(toolId)) category = "Archivos";
    else category = "Utilidades";
    if (!groups[category]) groups[category] = [];
    groups[category].push(def.displayName);
  }

  const lines = Object.entries(groups)
    .map(([cat, names]) => `${cat}: ${names.join(", ")}.`)
    .join("\n");

  return `<herramientas_activas>
Tienes acceso a las siguientes herramientas:

${lines}
</herramientas_activas>`;
}
```

- [ ] **Step 2.3: Inyectar el bloque en el system prompt**

En `packages/agent/src/graph.ts` (líneas 653-658), reemplazar la construcción del `wrappedSystemPrompt`:

```typescript
    // Wrap the user-controlled system prompt in XML delimiters to prevent
    // prompt injection from influencing the model's core instructions.
    const wrappedSystemPrompt = `<user_persona>\n${systemPrompt}\n</user_persona>`;
    finalState = await app.invoke(
      { messages: [new HumanMessage(message!)], sessionId, userId, systemPrompt: wrappedSystemPrompt },
      config
    );
```

Por:

```typescript
    // Wrap the user-controlled system prompt in XML delimiters to prevent
    // prompt injection from influencing the model's core instructions.
    const toolsBlock = buildToolsBlock(enabledTools, isDemoUser ?? false);
    const wrappedSystemPrompt = toolsBlock
      ? `<user_persona>\n${systemPrompt}\n</user_persona>\n\n${toolsBlock}`
      : `<user_persona>\n${systemPrompt}\n</user_persona>`;
    finalState = await app.invoke(
      { messages: [new HumanMessage(message!)], sessionId, userId, systemPrompt: wrappedSystemPrompt },
      config
    );
```

- [ ] **Step 2.4: Pasar isDemoUser desde la ruta de chat**

En `apps/web/src/app/api/chat/route.ts` (línea 180, cierre del objeto `runAgent({...})`), añadir `isDemoUser` al objeto de opciones:

```typescript
    const result = await runAgent({
      message,
      userId: user.id,
      sessionId: session.id,
      systemPrompt: (profile?.agent_system_prompt as string) ?? "Eres un asistente útil.",
      db,
      enabledTools: effectiveToolSettings.map((t: Record<string, unknown>) => ({
        id: t.id as string,
        user_id: t.user_id as string,
        tool_id: t.tool_id as string,
        enabled: t.enabled as boolean,
        config_json: (t.config_json as Record<string, unknown>) ?? {},
      })),
      integrations: (integrations ?? []).map((i: Record<string, unknown>) => ({
        id: i.id as string,
        user_id: i.user_id as string,
        provider: i.provider as string,
        scopes: (i.scopes as string[]) ?? [],
        status: i.status as "active" | "revoked" | "expired",
        created_at: i.created_at as string,
      })),
      githubToken,
      googleToken,
      notionToken,
      isDemoUser,
    });
```

- [ ] **Step 2.5: Verificar tipos del paquete agent**

```bash
npm run type-check -w @agents/agent
```

Resultado esperado: sin errores de TypeScript.

- [ ] **Step 2.6: Commit**

```bash
git add packages/agent/src/graph.ts apps/web/src/app/api/chat/route.ts
git -c skill.commit=true commit -m "feat(agent): inyectar herramientas activas en el system prompt"
```

---

## Task 3: Chips de sugerencia en el chat vacío

**Files:**
- Modify: `apps/web/src/app/chat/chat-interface.tsx`
- Modify: `apps/web/src/app/chat/page.tsx`

- [ ] **Step 3.1: Añadir prop enabledTools a ChatInterface**

En `apps/web/src/app/chat/chat-interface.tsx`, ampliar la interfaz `Props` (línea 91-97):

```typescript
interface Props {
  agentName: string;
  initialMessages: Array<{ role: string; content: string; created_at?: string; structured_payload?: Record<string, unknown> }>;
  sessions: SessionItem[];
  currentSessionId: string | null;
  initialPendingConfirmation: PendingConfirmation | null;
  enabledTools: string[];
}
```

Y actualizar la desestructuración del componente (línea 150-156):

```typescript
export function ChatInterface({
  agentName,
  initialMessages,
  sessions,
  currentSessionId,
  initialPendingConfirmation,
  enabledTools,
}: Props) {
```

- [ ] **Step 3.2: Añadir función getChips y handleChipClick en chat-interface.tsx**

Añadir estas dos funciones en el componente `ChatInterface`, justo antes del `return` (después de la línea `const hasPendingConfirmation = ...`):

```typescript
  function getChips(tools: string[]): Array<{ label: string; message: string }> {
    const dynamic: Array<{ label: string; message: string }> = [];
    if (tools.some((t) => t === "github_list_repos" || t === "github_list_issues")) {
      dynamic.push({ label: "Lista mis repositorios", message: "Lista mis repositorios" });
    }
    if (tools.some((t) => t === "google_calendar_list_events" || t === "google_calendar_list_calendars")) {
      dynamic.push({ label: "Eventos de esta semana", message: "Muestra mis eventos de esta semana" });
    }
    if (tools.some((t) => t === "notion_search" || t === "notion_get_page")) {
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

  async function handleChipClick(chipMessage: string) {
    if (loading || !activeSessionId || hasPendingConfirmation) return;
    setMessages((prev) => [...prev, { role: "user", content: chipMessage }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chipMessage, sessionId: activeSessionId }),
      });
      const data = await res.json();
      if (data.response) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
      }
      if (data.responseType === "pending_confirmation" && data.pendingConfirmation) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.pendingConfirmation.message,
            confirmation: data.pendingConfirmation,
            confirmationStatus: "pending",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error al procesar tu mensaje. Intenta de nuevo." },
      ]);
    } finally {
      setLoading(false);
    }
  }
```

Nota: `handleChipClick` llama directamente a la API sin pasar por el estado del input para evitar problemas de sincronización de estado en React.

- [ ] **Step 3.3: Reemplazar el empty state con chips**

En `apps/web/src/app/chat/chat-interface.tsx` (líneas 403-410), reemplazar el bloque del empty state que se editó en Task 1 por la versión con chips:

```tsx
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-lg font-medium text-neutral-600 dark:text-neutral-300">
                  Hola, soy tu agente.
                </p>
                <p className="mt-1 text-sm text-neutral-400">
                  Prueba alguna de estas acciones o escribe lo que necesitas.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {getChips(enabledTools).map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => handleChipClick(chip.message)}
                      disabled={loading || !activeSessionId || hasPendingConfirmation}
                      className="rounded-full border border-blue-300 bg-blue-50 px-4 py-1.5 text-sm text-blue-700 transition hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
```

- [ ] **Step 3.4: Consultar herramientas habilitadas en chat/page.tsx**

En `apps/web/src/app/chat/page.tsx`, añadir la query de `user_tool_settings` después de la query de `profile` (alrededor de línea 15, después del bloque de profile):

```typescript
  const { data: toolSettings } = await supabase
    .from("user_tool_settings")
    .select("tool_id")
    .eq("user_id", user.id)
    .eq("enabled", true);

  const enabledToolIds = (toolSettings ?? []).map((t) => t.tool_id as string);
```

- [ ] **Step 3.5: Pasar enabledToolIds a ChatInterface**

En `apps/web/src/app/chat/page.tsx` (alrededor de línea 151-157), añadir el prop `enabledTools`:

```tsx
      <ChatInterface
        agentName={profile.agent_name as string}
        initialMessages={sessionMessages}
        sessions={allSessions}
        currentSessionId={currentSession?.id ?? null}
        initialPendingConfirmation={initialPendingConfirmation}
        enabledTools={enabledToolIds}
      />
```

- [ ] **Step 3.6: Verificar tipos**

```bash
npm run type-check -w @agents/web
```

Resultado esperado: sin errores de TypeScript.

- [ ] **Step 3.7: Commit**

```bash
git add apps/web/src/app/chat/chat-interface.tsx apps/web/src/app/chat/page.tsx
git -c skill.commit=true commit -m "feat(chat): agregar chips de sugerencia en el estado vacío del chat"
```

---

## Task 4: Tarjetas de categoría en el paso de herramientas del wizard

**Files:**
- Rewrite: `apps/web/src/app/onboarding/steps/step-tools.tsx`

- [ ] **Step 4.1: Reescribir step-tools.tsx con tarjetas por categoría**

Reemplazar el contenido completo de `apps/web/src/app/onboarding/steps/step-tools.tsx`:

```typescript
"use client";

import { TOOL_CATALOG, getToolRisk } from "@agents/types";
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
```

- [ ] **Step 4.2: Verificar que getToolRisk sigue importándose correctamente**

La función `getToolRisk` ya no se usa en este componente (el riesgo se accede via `t.risk` del catalog). Actualizar el import al inicio del archivo:

```typescript
import { TOOL_CATALOG } from "@agents/types";
```

Eliminar `getToolRisk` del import.

- [ ] **Step 4.3: Verificar tipos del wizard**

```bash
npm run type-check -w @agents/web
```

Resultado esperado: sin errores de TypeScript.

- [ ] **Step 4.4: Commit**

```bash
git add apps/web/src/app/onboarding/steps/step-tools.tsx
git -c skill.commit=true commit -m "feat(onboarding): rediseñar paso de herramientas con tarjetas por categoría"
```

---

## Verificación final

- [ ] **Step 5.1: Type-check global**

```bash
npm run type-check
```

Resultado esperado: sin errores en ningún paquete.

- [ ] **Step 5.2: Arrancar la app y verificar el flujo completo**

```bash
npm run dev
```

Verificar manualmente:
1. Ir a `http://localhost:3000/login` — el botón dice "Ver demo en vivo" sin flecha.
2. Hacer clic en "Ver demo en vivo" — entra al wizard de demo.
3. Llegar al paso 3 (Herramientas) — se ven tarjetas por categoría con ejemplos.
4. Las categorías GitHub, Google Calendar y Notion muestran "Requiere registro".
5. Las categorías Archivos y Utilidades tienen sus herramientas activables.
6. Terminar el wizard y llegar al chat.
7. El chat vacío muestra "Hola, soy tu agente." y chips de sugerencia.
8. El banner demo dice "Estás probando el demo. Solo herramientas de lectura disponibles." sin guiones largos.
9. Hacer clic en un chip: el mensaje se envía automáticamente.
10. Enviar "¿Qué puedes hacer?" — el agente responde mencionando las herramientas disponibles en demo.
11. Ir a Ajustes — la lista de herramientas usa ":" en lugar de "—".
