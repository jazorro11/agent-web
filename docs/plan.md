# Plan de Implementación — Agente Personal MVP

Construir un agente que permita a un usuario **gestionar tareas y ejecutar acciones útiles** desde chat: consultar calendario y correo, buscar documentos, disparar workflows internos, operar GitHub en casos acotados. El sistema debe priorizar **control, trazabilidad, seguridad y costos predecibles** por encima de “autonomía máxima”.

## Fases y estado

### Fase 1: Fundaciones ✅ COMPLETADA

- [x] Monorepo Turborepo con npm workspaces
- [x] `apps/web` — Next.js con App Router + Tailwind
- [x] `packages/agent` — LangGraph JS + tools
- [x] `packages/db` — cliente Supabase + queries tipadas
- [x] `packages/types` — interfaces compartidas
- [x] `packages/config` — tsconfig compartido
- [x] `.env.example` con variables necesarias
- [x] Migración SQL con RLS (`00001_initial_schema.sql`)

### Fase 2: Core agente ✅ COMPLETADA

- [x] Grafo LangGraph: `agent → tools → agent` con máx 6 iteraciones
- [x] Modelo vía OpenRouter (ChatOpenAI con baseURL)
- [x] Catálogo de tools con risk levels
- [x] Adapters LangChain `tool()` con policy (allowlist + integración)
- [x] Persistencia de mensajes en `agent_messages`
- [x] API route `/api/chat` que orquesta todo
- [x] Message compaction (microcompact + LLM compaction)

### Fase 3: Onboarding y UI ✅ COMPLETADA

- [x] Login y signup con Supabase Auth
- [x] Middleware de protección de rutas
- [x] Wizard onboarding multi-paso (perfil → agente → tools → revisión)
- [x] Página de chat con interfaz de mensajes
- [x] Página de ajustes (editar perfil, agente, tools, vincular integraciones)
- [x] Redirect inteligente: `/` → `/onboarding` (si no completado) → `/chat`
- [x] Inline markdown rendering para mensajes del asistente

### Fase 4: Tools con confirmación ✅ COMPLETADA

- [x] Tools internas: `get_user_preferences`, `list_enabled_tools`
- [x] Tools GitHub: `github_list_repos`, `github_list_issues`, `github_create_issue`, `github_create_repo`
- [x] Confirmación humana (HITL) para tools de riesgo medium/high
- [x] Tabla `tool_calls` para tracking de estado
- [x] File tools: `read_file`, `write_file`, `edit_file` (con confirmación)
- [x] Bash tool (con confirmación)
- [x] Session management y persistence

### Fase 5: Integraciones OAuth ✅ COMPLETADA

- [x] Google Calendar: OAuth flow, event creation, tool definitions
- [x] GitHub: OAuth flow, repository y issue operations
- [x] Notion: OAuth flow, database schema support
- [x] Cifrado de tokens OAuth (AES-256-GCM)
- [x] Settings UI para conectar/desconectar integraciones

### Fase 6: Telegram ✅ COMPLETADA

- [x] Webhook en `/api/telegram/webhook`
- [x] Comando `/start` con instrucciones
- [x] Comando `/link CODE` para vincular cuenta
- [x] Tabla `telegram_link_codes` con expiración
- [x] Mismo `runAgent()` que web
- [x] Confirmaciones con botones inline (aprobar/rechazar)
- [x] Setup endpoint `/api/telegram/setup` para registrar webhook

### Fase 7: Memory y Tracing ✅ COMPLETADA

- [x] Long-term memory system (extraction, injection, storage)
- [x] Langfuse integration para tracing y monitoring
- [x] OpenTelemetry configuration
- [x] RunnableConfig support para graph processing

### Fase 8: Scheduled Tasks ✅ COMPLETADA

- [x] Cron integration para tareas one-time y recurring
- [x] Database schema para task management
- [x] Notificaciones vía Telegram
- [x] API endpoint `/api/cron/scheduled-tasks` para ejecutar tareas

### Fase 9: Documentación ✅ EN PROGRESO

- [x] `docs/architecture.md` — arquitectura técnica viva
- [x] `docs/brief.md` — visión y propósito del producto
- [x] `docs/plan.md` — este archivo, phases e implementación
- [x] `docs/github-integration.md` — guía OAuth de GitHub
- [x] `CLAUDE.md` — instrucciones para trabajar en el repo

---

## Notas

- **MVP funcional**: Todas las fases principales completadas (chatbot, tools, confirmaciones, integraciones, Telegram).
- **Extensiones**: Memory, tracing y scheduled tasks fueron agregadas durante el desarrollo.
- **Estado actual**: Código funcional en `main`, listo para desarrollo continuo o deployment.
