# Arquitectura Técnica — Agente Personal MVP

## Stack

| Capa                  | Tecnología                           | Paquete                              |
| --------------------- | ------------------------------------ | ------------------------------------ |
| Monorepo              | Turborepo + npm workspaces           | raíz                                 |
| Frontend / API routes | Next.js (App Router)                 | `apps/web`                           |
| Agente runtime        | LangGraph JS + LangChain core        | `packages/agent`                     |
| Base de datos + Auth  | Supabase (Postgres + Auth + RLS)     | `packages/db`                        |
| Tipos compartidos     | TypeScript                           | `packages/types`                     |
| Config compartida     | tsconfig                             | `packages/config`                    |
| Modelo LLM            | OpenRouter (GPT-4o-mini por defecto) | vía `@langchain/openai` con base URL |

## Estructura del monorepo

```
agents/
├── apps/
│   └── web/                    # Next.js — UI + API routes
│       └── src/
│           ├── app/
│           │   ├── login/      # Autenticación
│           │   ├── signup/
│           │   ├── onboarding/ # Wizard multi-paso
│           │   ├── chat/       # Interfaz de chat
│           │   ├── settings/   # Ajustes post-onboarding
│           │   └── api/
│           │       ├── chat/           # POST → runAgent
│           │       ├── auth/signout/   # POST → signout
│           │       └── telegram/
│           │           ├── webhook/    # POST → bot Telegram
│           │           └── setup/      # GET → registrar webhook
│           ├── lib/supabase/   # Helpers SSR
│           └── middleware.ts   # Auth guard
├── packages/
│   ├── agent/                  # LangGraph grafo + tools
│   │   └── src/
│   │       ├── graph.ts        # StateGraph: agent → tools → agent loop
│   │       ├── model.ts        # ChatOpenAI vía OpenRouter
│   │       └── tools/
│   │           ├── catalog.ts  # Definiciones (id, risk, schema)
│   │           └── adapters.ts # LangChain tool() wrappers
│   ├── db/                     # Supabase client + queries tipadas
│   │   └── src/queries/        # profiles, sessions, messages, tools, integrations, telegram, tool-calls
│   ├── types/                  # Interfaces compartidas
│   └── config/                 # tsconfig base/next
├── docs/
│   ├── brief.md                # Brief original del producto
│   ├── architecture.md         # ← este archivo
│   └── plan.md                 # Plan de implementación
└── turbo.json                  # Pipeline: build, dev, lint, type-check
```

## Diagrama de componentes

```
┌─────────────┐    ┌──────────────┐
│  Next.js UI │    │ Telegram Bot │
│  (web chat) │    │  (webhook)   │
└──────┬──────┘    └──────┬───────┘
       │                  │
       ▼                  ▼
┌─────────────────────────────────┐
│     Supabase Auth (JWT)         │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│   LangGraph Runtime (grafo)     │
│   ┌─────────┐  ┌────────────┐  │
│   │  Agent   │→ │ Tool Exec  │  │
│   │  Node    │← │  + Policy  │  │
│   └─────────┘  └────────────┘  │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│    Supabase Postgres (RLS)      │
│  profiles | sessions | messages │
│  tool_calls | user_tool_settings│
│  user_integrations | telegram   │
└─────────────────────────────────┘
```

## Flujo de un request de chat

1. Usuario envía mensaje (web POST `/api/chat` o Telegram webhook).
2. Se autentica al usuario (JWT en web, lookup `telegram_accounts` en Telegram).
3. Se carga o crea `agent_session` para el canal.
4. Se cargan `profile`, `user_tool_settings` e `integrations`.
5. Se filtran las tools disponibles (allowlist + integración activa).
6. Se invoca `runAgent()`:
   - Se construye el historial (últimos 30 mensajes de la sesión).
   - LangGraph ejecuta el grafo: `agent → [tools] → agent` (máx 6 iteraciones).
   - Si una tool tiene riesgo medio/alto, devuelve `pending_confirmation` en lugar de ejecutar.
7. Se persisten los mensajes (user + assistant) en `agent_messages`.
8. Se devuelve la respuesta al canal.

## LangGraph: grafo simplificado

- **StateGraph** con dos nodos: `agent` (invoca modelo con tools) y `tools` (ejecuta tool calls).
- **Arista condicional** desde `agent`: si hay tool calls → `tools` → `agent`; si no → `__end__`.
- **PostgresSaver** como checkpointer persistente (thread_id = session_id), respaldado por `DATABASE_URL`.
- Máximo 6 iteraciones de tool para evitar loops.

## LangChain: qué usamos

- `@langchain/core`: `HumanMessage`, `AIMessage`, `SystemMessage`, `ToolMessage`, `tool()`.
- `@langchain/openai`: `ChatOpenAI` con `baseURL` apuntando a OpenRouter.
- `@langchain/langgraph`: `StateGraph`, `Annotation`, `END`.
- `@langchain/langgraph-checkpoint-postgres`: `PostgresSaver` para checkpointing persistente.

## Modelo de datos

Ver migración completa en `packages/db/supabase/migrations/00001_initial_schema.sql`.

Tablas: `profiles`, `user_integrations`, `user_tool_settings`, `agent_sessions`, `agent_messages`, `tool_calls`, `telegram_accounts`, `telegram_link_codes`.

Todas con **RLS habilitado** y políticas por `user_id` desde el día 1.

## Seguridad

- **RLS** en toda tabla con datos de usuario.
- **Allowlist de tools**: solo se montan las que el usuario habilitó en onboarding/ajustes Y para las que tiene integración activa.
- **Confirmación humana**: tools de riesgo medio/alto generan `pending_confirmation` en lugar de ejecutar. En web se muestra prompt; en Telegram, botones inline.
- **Tokens OAuth**: campo `encrypted_tokens` en `user_integrations` (cifrado en aplicación).
- **Budget**: `budget_tokens_limit` por sesión para evitar costes descontrolados.

## Canales

- **Web**: Next.js App Router, POST síncrono a `/api/chat`.
- **Telegram**: webhook en `/api/telegram/webhook`, vinculación via código de un solo uso (`/link CODE`), confirmaciones con `inline_keyboard`.
