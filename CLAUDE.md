# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack y versiones

Monorepo Turborepo + npm workspaces, Node ≥ 20. Stack:

- **Next.js 16.2.1** (App Router) + **React 19.2.4** en `apps/web`.
- **LangGraph JS ^1.0** + **LangChain core 1.1.41** (fijado vía `overrides` en el `package.json` raíz) en `packages/agent`.
- **Supabase** (Postgres + Auth + RLS) en `packages/db`.
- **OpenRouter** como gateway de LLM. Modelo por defecto: `openai/gpt-4o-mini`, configurado en [packages/agent/src/model.ts](packages/agent/src/model.ts).
- **Langfuse + OpenTelemetry** para tracing (`@langfuse/langchain`, `@langfuse/otel`).

> **⚠️ Este NO es el Next.js que conoces.** Next.js 16 tiene cambios breaking respecto al training data (APIs, convenciones, estructura de archivos). Antes de tocar código de `apps/web`, lee la guía relevante en `node_modules/next/dist/docs/` y atiende las deprecation notices. Esta regla también vive en [apps/web/AGENTS.md](apps/web/AGENTS.md).

## Comandos

Desde la raíz del monorepo:

| Comando | Qué hace |
|---------|----------|
| `npm install` | Instala dependencias del workspace completo |
| `npm run dev` | Levanta todos los `dev` (Next en `:3000`) — Turbo en modo persistente |
| `npm run build` | Build de los paquetes con tarea `build` definida |
| `npm run lint` | Lint (ESLint flat config en `apps/web`) |
| `npm run type-check` | `tsc --noEmit` recursivo en todos los paquetes |

Builds y checks dirigidos:

- Solo la app Next: `cd apps/web && npx next build` (útil para validar tipos antes de desplegar).
- Type-check de un paquete: `npm run type-check -w @agents/web` (o `@agents/agent`, `@agents/db`).

**No hay scripts de `test`** en ningún `package.json` del repo. `npm test` falla — no existe suite configurada todavía.

## Variables de entorno (gotcha crítico)

Next.js carga `.env*` desde **`apps/web`, no desde la raíz del monorepo**. Si pones los secrets en la raíz, la app arranca pero Supabase y OpenRouter fallan en runtime sin un mensaje claro.

- Archivo correcto: `apps/web/.env.local`.
- Plantilla: [.env.example](.env.example) en la raíz.
- Obligatorias: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`.
- Opcionales: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OAUTH_ENCRYPTION_KEY`.

Setup paso a paso completo (Supabase, migraciones SQL, Telegram) en [README.md](README.md).

## Arquitectura: flujo de un request de chat

1. **Entrada**: web (`POST /api/chat`) o Telegram (`POST /api/telegram/webhook`).
2. **Auth**: JWT de Supabase en web; lookup en `telegram_accounts` para Telegram.
3. **Carga de contexto**: `profile`, `user_tool_settings`, `user_integrations`, y los últimos 30 mensajes de `agent_messages` para la `agent_session` activa.
4. **Filtrado de tools**: solo se montan las tools que el usuario habilitó **y** para las que tiene integración activa (allowlist + policy en [packages/agent/src/tools/](packages/agent/src/tools/)).
5. **`runAgent()`**: LangGraph ejecuta el grafo `agent → [tools] → agent` con **máximo 6 iteraciones** (anti-loop).
6. **Confirmación humana**: tools de riesgo `medium`/`high` devuelven `pending_confirmation` en lugar de ejecutar — en web se muestra prompt, en Telegram botones inline.
7. **Persistencia**: mensajes user + assistant en `agent_messages`; tool calls en `tool_calls`.

Detalle del grafo y diagrama en [docs/architecture.md](docs/architecture.md). Brief de producto en [docs/brief.md](docs/brief.md). Fases de implementación en [docs/plan.md](docs/plan.md).

## Modelo de datos y RLS

Fuente de verdad: migraciones en [packages/db/supabase/migrations/](packages/db/supabase/migrations/) (schema inicial, sesiones, scheduled tasks, long-term memory).

Tablas principales: `profiles`, `agent_sessions`, `agent_messages`, `tool_calls`, `user_tool_settings`, `user_integrations`, `telegram_accounts`, `telegram_link_codes`.

**Toda tabla con datos de usuario tiene RLS habilitado** con políticas por `user_id`. Cualquier query desde el servidor debe:

- Usar el cliente SSR de [apps/web/src/lib/supabase/server.ts](apps/web/src/lib/supabase/server.ts), que mantiene el JWT del usuario. **No** uses un cliente con `service_role` salvo donde la operación lo exige (webhook de Telegram, jobs de fondo).
- Verificar que la sesión Supabase está hidratada antes de llamar queries; si no, las queries fallan en silencio devolviendo `[]`.

Queries tipadas ya existen en [packages/db/src/queries/](packages/db/src/queries/) (`profiles`, `sessions`, `messages`, `tools`, `tool-calls`, `scheduled-tasks`, `telegram`, `memories`). **Reusa estas funciones antes de escribir SQL ad-hoc.**

## Convenciones del monorepo

- **Workspaces**: `apps/*` (solo `web` por ahora) y `packages/*` (`agent`, `db`, `types`, `config`).
- **Imports entre paquetes**: usa el alias `@agents/<paquete>` (`@agents/db`, `@agents/types`, `@agents/agent`). Los paquetes internos tienen `main` y `types` apuntando directo a `./src/index.ts` — **no hay step de build entre paquetes**, todo se consume como TypeScript.
- **Alias dentro de `apps/web`**: `@/*` → `apps/web/src/*` (configurado en [apps/web/tsconfig.json](apps/web/tsconfig.json)).
- **Tipos compartidos** van en `@agents/types`. El catálogo de tools (`TOOL_CATALOG`, `getToolRisk`, `toolRequiresConfirmation`) vive ahí y se re-exporta desde [packages/agent/src/tools/catalog.ts](packages/agent/src/tools/catalog.ts).
- **Override crítico**: `@langchain/core` está fijado a `1.1.41` en `package.json` raíz para evitar mismatches entre `@langchain/langgraph` y `@langchain/openai`. No lo actualices a la ligera.

## Seguridad — qué no romper

- **RLS** no se desactiva ni se rodea con `service_role` salvo en endpoints específicos (webhook de Telegram, tareas programadas).
- **Allowlist de tools**: nunca montes una tool sin verificar `user_tool_settings` + integración activa correspondiente.
- **Confirmación humana**: si una tool tiene riesgo `medium`/`high`, debe devolver `pending_confirmation`. No la conviertas en ejecución directa "por simplicidad".
- **Tokens OAuth**: `user_integrations.encrypted_tokens` se persiste cifrado a nivel de aplicación. No lo guardes plano.
