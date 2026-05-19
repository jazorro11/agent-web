# Tareas programadas (Scheduled Tasks)

## Arquitectura

```
Usuario (chat)
    │  "Recuérdame revisar mis issues el lunes a las 9 AM"
    ▼
Agente  ──[schedule_task tool]──► scheduled_tasks (DB)
                                        │
                              (next_run_at <= now)
                                        │
Supabase Cron ──► POST /api/cron/scheduled-tasks
                        │
                        ├──► runAgent(prompt del usuario)
                        ├──► scheduled_task_runs (audit)
                        └──► Telegram sendMessage (por defecto)
```

## Tablas nuevas

### `scheduled_tasks`
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | uuid | PK |
| `user_id` | uuid | FK → profiles |
| `prompt` | text | Instrucción que se enviará al agente |
| `schedule_type` | text | `one_time` o `recurring` |
| `run_at` | timestamptz | Para one_time: cuándo ejecutar |
| `cron_expr` | text | Para recurring: expresión cron de 5 campos |
| `timezone` | text | IANA timezone (ej. `America/Bogota`) |
| `status` | text | `active`, `paused`, `completed`, `failed` |
| `last_run_at` | timestamptz | Última ejecución |
| `next_run_at` | timestamptz | Próxima ejecución (índice para el runner) |

### `scheduled_task_runs`
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | uuid | PK |
| `task_id` | uuid | FK → scheduled_tasks |
| `status` | text | `running`, `completed`, `failed` |
| `started_at` | timestamptz | Inicio de ejecución |
| `finished_at` | timestamptz | Fin de ejecución |
| `error` | text | Mensaje de error si falló |
| `agent_session_id` | uuid | Sesión del agente usada (canal `cron`) |
| `notified` | boolean | Si se envió notificación Telegram |
| `notification_error` | text | Razón si no se notificó |

## Setup

### 1. Aplicar la migración SQL

En el panel de Supabase → SQL Editor, ejecuta el contenido de:

```
packages/db/supabase/migrations/00003_scheduled_tasks.sql
```

O con la CLI de Supabase:
```bash
supabase db push
```

### 2. Variables de entorno

Agrega a tu `.env.local`:
```
CRON_SECRET=un-token-secreto-largo-y-aleatorio
```

### 3. Configurar Supabase Cron

En el panel de Supabase → **Database → Extensions**, activa `pg_cron`.

Luego en **Database → Cron Jobs**, crea un nuevo job:

```sql
SELECT cron.schedule(
  'run-scheduled-tasks',          -- nombre del job
  '* * * * *',                    -- cada minuto
  $$
    SELECT net.http_post(
      url := 'https://TU_DOMINIO/api/cron/scheduled-tasks',
      headers := '{"Authorization": "Bearer TU_CRON_SECRET", "Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);
```

> Reemplaza `TU_DOMINIO` con tu dominio de producción y `TU_CRON_SECRET` con el valor de `CRON_SECRET`.

**Alternativa con Supabase Edge Functions:**
Crea una Edge Function que haga el `fetch` al endpoint cada minuto usando `Deno.cron`.

### 4. Habilitar el tool para el usuario

El tool `schedule_task` tiene riesgo `medium`, por lo que requiere que el usuario lo habilite en Ajustes → Herramientas.

## Uso desde el chat

### Tarea de una sola vez
```
Recuérdame el viernes 11 de abril a las 9 AM revisar el estado de los issues de GitHub del repo lab10/agents
```
El agente llamará a `schedule_task` con:
- `schedule_type: "one_time"`
- `run_at: "2026-04-11T09:00:00-05:00"`
- `prompt: "Revisa el estado de los issues de GitHub del repo lab10/agents"`

### Tarea recurrente
```
Todos los lunes a las 8 AM quiero que me des un resumen de los issues abiertos de mi repo principal
```
El agente llamará a `schedule_task` con:
- `schedule_type: "recurring"`
- `cron_expr: "0 8 * * 1"`
- `timezone: "America/Bogota"` (si está configurado en el perfil)

### Referencia de expresiones cron
| Expresión | Significado |
|-----------|-------------|
| `0 9 * * 1` | Cada lunes a las 9 AM |
| `0 8 * * 1-5` | Lunes a viernes a las 8 AM |
| `0 */6 * * *` | Cada 6 horas |
| `0 9 1 * *` | El 1ro de cada mes a las 9 AM |
| `*/15 * * * *` | Cada 15 minutos |

## Notificaciones Telegram

Por defecto, cada ejecución envía el resultado al chat de Telegram vinculado.  
Si el usuario **no tiene Telegram vinculado**, la ejecución continúa normalmente y se registra `notified=false` con motivo `no_telegram_link` en `scheduled_task_runs`. No se lanza error.

## Pruebas manuales

### Verificar que el tool funciona
1. Habilita `schedule_task` en Ajustes → Herramientas.
2. En el chat escribe: "Programa una tarea para dentro de 2 minutos que me diga hola".
3. Confirma la acción cuando el agente la solicite.
4. Revisa la tabla `scheduled_tasks` en Supabase.

### Disparar el cron manualmente
```bash
curl -X POST https://TU_DOMINIO/api/cron/scheduled-tasks \
  -H "Authorization: Bearer TU_CRON_SECRET" \
  -H "Content-Type: application/json"
```

Respuesta esperada:
```json
{
  "processed": 1,
  "results": [{ "task_id": "...", "status": "ok" }]
}
```

### Verificar ejecución
Revisa en Supabase:
- `scheduled_task_runs`: debe haber un registro con `status=completed`
- `agent_sessions`: debe existir una sesión con `channel=cron`
- `agent_messages`: debe tener los mensajes de esa sesión
- Si tienes Telegram vinculado, debes recibir el mensaje
