---
name: scheduled-tasks-agent
overview: Agregar soporte de tareas programadas con un nuevo tool del agente, un endpoint cron en Next.js ejecutado cada minuto por Supabase Cron, y notificación por Telegram por defecto (con fallback a log si no hay Telegram vinculado).
todos:
  - id: db-schema-and-queries
    content: Diseñar migración para scheduled_tasks y scheduled_task_runs + queries de lectura/actualización atómica
    status: pending
  - id: agent-tool
    content: Agregar tool schedule_task al catálogo, schema y adapter handler
    status: pending
  - id: cron-endpoint
    content: Crear endpoint /api/cron/scheduled-tasks con auth CRON_SECRET y ejecución runAgent
    status: pending
  - id: telegram-default-notify
    content: Reutilizar/extract util de envío Telegram y registrar fallback sin Telegram
    status: pending
  - id: docs-and-env
    content: Actualizar .env.example y documentación de setup de Supabase Cron + pruebas manuales
    status: pending
isProject: false
---

# Plan de implementación: tareas programadas del agente

## Objetivo

Implementar una primera versión productiva donde el agente pueda crear tareas programadas (one-time y recurrentes), un cron externo de Supabase ejecute pendientes cada minuto vía endpoint de Next.js, y cada ejecución notifique por Telegram por defecto.

## Diseño técnico propuesto

```mermaid
flowchart TD
  agent[Agent]
  scheduleTool[scheduleTaskTool]
  scheduledTasks[(scheduled_tasks)]
  cronRunner[/api/cron/scheduled-tasks]
  runAgentCall[runAgent]
  telegramAccounts[(telegram_accounts)]
  telegramApi[TelegramBotAPI]
  executionLogs[(scheduled_task_runs)]

  agent --> scheduleTool
  scheduleTool --> scheduledTasks
  cronRunner --> scheduledTasks
  cronRunner --> runAgentCall
  cronRunner --> executionLogs
  cronRunner --> telegramAccounts
  telegramAccounts --> telegramApi
```



## Cambios por capa

- **Base de datos (migraciones + queries)**
  - Crear tabla `scheduled_tasks` con campos mínimos: `id`, `user_id`, `prompt`, `schedule_type`, `run_at`, `cron_expr`, `timezone`, `status`, `last_run_at`, `next_run_at`, `created_at`, `updated_at`.
  - Crear tabla `scheduled_task_runs` para auditoría de ejecuciones: `task_id`, `status`, `started_at`, `finished_at`, `error`, `agent_session_id`.
  - Índices para lectura por minuto (`status`, `next_run_at`) y RLS alineada al patrón existente.
  - Añadir queries en [packages/db/src/queries](packages/db/src/queries) para: crear tarea, listar pendientes, bloquear/marcar running, completar/fallar, recalcular `next_run_at` para recurrentes.
- **Tool del agente (creación de tareas)**
  - Registrar nuevo tool en [packages/types/src/catalog.ts](packages/types/src/catalog.ts) con riesgo `medium` (requiere confirmación humana en el flujo HITL ya existente).
  - Definir schema Zod en [packages/agent/src/tools/schemas.ts](packages/agent/src/tools/schemas.ts) soportando:
    - one-time: `runAt`.
    - recurrente: `cronExpr` + `timezone`.
  - Implementar handler en [packages/agent/src/tools/adapters.ts](packages/agent/src/tools/adapters.ts) para persistir en `scheduled_tasks` y devolver resumen legible para el usuario.
- **Runner cron (cada minuto)**
  - Crear endpoint seguro en `apps/web/src/app/api/cron/scheduled-tasks/route.ts` con header secreto (`CRON_SECRET`) para invocación server-to-server desde Supabase Cron.
  - Flujo del endpoint:
    - leer tareas vencidas (`next_run_at <= now`, `status=active`),
    - crear registro de ejecución,
    - invocar `runAgent` por tarea con sesión dedicada de background,
    - marcar resultado y recalcular `next_run_at` (recurrente) o `completed` (one-time).
  - Asegurar idempotencia básica con actualización atómica a estado `running` antes de ejecutar.
  - **Middleware de autenticación**: el endpoint no lleva cookie de sesión de usuario, por lo que debe estar exento del middleware de login de Supabase. En [`apps/web/src/lib/supabase/middleware.ts`](../apps/web/src/lib/supabase/middleware.ts) existe la variable `isPublicApi` para excluir cualquier ruta bajo `/api/cron/`. Si se agrega un nuevo endpoint cron con una ruta diferente, debe añadirse al mismo bloque:
    ```ts
    const isPublicApi =
      pathname.startsWith("/api/telegram/webhook") ||
      pathname.startsWith("/api/cron/");   // ← cubre todos los endpoints cron
    ```
- **Notificación Telegram por defecto**
  - Reutilizar integración existente de `telegram_accounts` en [packages/db/src/queries/telegram.ts](packages/db/src/queries/telegram.ts).
  - Extraer utilitario compartido de envío Telegram (hoy está acoplado al webhook) y usarlo desde el cron runner.
  - Política acordada: si no hay Telegram vinculado, **no falla**; se registra en `scheduled_task_runs` como `notified=false` con motivo `no_telegram_link`.
- **Configuración y documentación**
  - Agregar variables en [apps/web/.env.example](apps/web/.env.example): `CRON_SECRET` y cualquier valor adicional necesario para la ruta.
  - Documentar setup operativo en `docs/phase-2-tools-design/`:
    - SQL/migración,
    - creación del cron en Supabase (cada minuto),
    - endpoint y autenticación,
    - ejemplos de prompts para crear tareas.

## Archivos principales a tocar

- [packages/types/src/catalog.ts](packages/types/src/catalog.ts)
- [packages/agent/src/tools/schemas.ts](packages/agent/src/tools/schemas.ts)
- [packages/agent/src/tools/adapters.ts](packages/agent/src/tools/adapters.ts)
- [packages/db/supabase/migrations](packages/db/supabase/migrations)
- [packages/db/src/queries](packages/db/src/queries)
- `apps/web/src/app/api/cron/scheduled-tasks/route.ts` (nuevo)
- [apps/web/.env.example](apps/web/.env.example)
- [apps/web/src/lib/supabase/middleware.ts](apps/web/src/lib/supabase/middleware.ts) — añadir la ruta al bloque `isPublicApi` si difiere de `/api/cron/`
- (si aplica) util compartido Telegram en `apps/web/src/lib/telegram/` o `packages/*`

## Validación

- Crear tarea one-time desde chat y verificar fila en `scheduled_tasks`.
- Ejecutar endpoint cron manualmente y validar:
  - registro en `scheduled_task_runs`,
  - llamada a `runAgent`,
  - notificación Telegram enviada.
- Crear tarea recurrente y validar recomputo de `next_run_at` tras ejecución.
- Caso sin Telegram vinculado: ejecución exitosa + log de `notified=false` sin error global.

