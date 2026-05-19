---
name: Tools de archivos
overview: Las herramientas se registran en el catálogo tipado, se validan con Zod, se ejecutan vía handlers en `adapters.ts` envueltos en `withTracking`, y las de riesgo medio/alto pasan por confirmación HITL en `graph.ts`. El plan añade `read_file`, `write_file` (solo creación) y `edit_file` con respuestas JSON explícitas, límites de seguridad por directorio raíz y mensajes de confirmación en español.
todos:
  - id: catalog-schemas
    content: Añadir las 3 entradas a TOOL_CATALOG y TOOL_SCHEMAS (Zod + parameters_schema)
    status: completed
  - id: fileTools-module
    content: "Implementar fileTools.ts: raíz segura, read/write/edit, respuestas { ok, error } explícitas"
    status: completed
  - id: wire-adapters-graph
    content: Registrar handlers en adapters.ts y casos de confirmación en graph.ts
    status: completed
  - id: onboarding-env
    content: Actualizar TOOL_IDS en wizard.tsx y documentar env en .env.example
    status: completed
isProject: false
---

# Plan: tools `read_file`, `write_file`, `edit_file`

## Cómo funciona el catálogo y el runtime hoy

- `**[packages/types/src/catalog.ts](packages/types/src/catalog.ts)**`: `TOOL_CATALOG` es un array de `ToolDefinition` (`id`, `name`, `description`, `risk`, `parameters_schema` JSON para UI/docs, `displayName` / `displayDescription`, opcional `requires_integration`). Helpers: `[getToolRisk](packages/types/src/catalog.ts)`, `[toolRequiresConfirmation](packages/types/src/catalog.ts)` (confirma si `risk` es `medium` o `high`).
- `**[packages/agent/src/tools/schemas.ts](packages/agent/src/tools/schemas.ts)**`: `TOOL_SCHEMAS` en Zod debe incluir **la misma clave** que `id` en el catálogo; LangChain usa ese schema para los argumentos del modelo.
- `**[packages/agent/src/tools/adapters.ts](packages/agent/src/tools/adapters.ts)`**: `buildLangChainTools` filtra por herramientas habilitadas en BD + integraciones; por cada entrada une `TOOL_SCHEMAS[id]` + `TOOL_HANDLERS[id]` y envuelve el handler con `[withTracking](packages/agent/src/tools/withTracking.ts)` (persistencia del call y resultado en BD; si el handler **lanza**, el resultado al modelo es `{ error: "..." }`).
- `**[packages/agent/src/graph.ts](packages/agent/src/graph.ts)`**: Antes de ejecutar, si `toolRequiresConfirmation(toolId)`, se crea un pending call, se muestra `[buildConfirmationMessage](packages/agent/src/graph.ts)` y se hace `interrupt` hasta `approve` / `reject`. Conviene añadir `case` para las nuevas tools mutadoras (resumen de path, no volcar contenido entero).
- **Patrón de errores “suaves”** (referencia): `[bashExec.ts](packages/agent/src/tools/bashExec.ts)` devuelve un objeto con `exitCode` y mensaje en `stderr` sin lanzar, para que el modelo siempre reciba JSON estructurado. Para file tools conviene el mismo enfoque: **no lanzar** salvo bugs internos; devolver `{ ok: false, ... }` con código y mensaje legible.

```mermaid
flowchart LR
  catalog[TOOL_CATALOG]
  zod[TOOL_SCHEMAS]
  handlers[TOOL_HANDLERS]
  track[withTracking]
  lc[LangChain tool]
  graph[toolExecutorNode]
  catalog --> handlers
  zod --> lc
  handlers --> track --> lc
  lc --> graph
```



## Decisiones de diseño recomendadas


| Aspecto                               | Recomendación                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Riesgo**                            | `read_file`: `low` (solo lectura). `write_file` y `edit_file`: `high` (cambian el disco; mismo patrón que `bash` → confirmación obligatoria).                                                                                                                                                                                                                                                                                         |
| **Alcance de paths**                  | Variable de entorno obligatoria para producción, p. ej. `FILE_TOOLS_ROOT` (ruta absoluta). Resolver `path` del usuario como **relativo a esa raíz**; rechazar `..`, paths absolutos fuera de la raíz y symlinks que escapen (usar `path.resolve` + comprobar prefijo de la raíz normalizada). Sin raíz configurada o con flag de desactivación: respuesta explícita tipo “herramienta deshabilitada” (análogo a `BASH_TOOL_ENABLED`). |
| `**offset` / `limit` en `read_file`** | Tratarlos como **número de línea inicial (1-based)** y **cantidad de líneas** (como en muchos agentes de código). Si faltan, leer archivo completo con **tope máximo** (p. ej. líneas o caracteres) para evitar cargar archivos enormes. Documentar en `description` del tool y en el schema Zod.                                                                                                                                     |
| `**write_file`**                      | Crear solo si el archivo **no existe**: `fs.open(path, 'wx')` o `access` + `writeFile` atómico; si existe → `ok: false` con mensaje claro (“el archivo ya existe; usa `edit_file`”). Crear directorios padre opcionalmente con `mkdir(..., { recursive: true })` o fallar si no existen (elegir una política y documentarla).                                                                                                         |
| `**edit_file`**                       | Leer UTF-8, exigir **exactamente una** ocurrencia de `old_string`; 0 o >1 → error explícito con hint. Tras reemplazo, escribir atomically (escribir temp + rename) si el SO lo permite.                                                                                                                                                                                                                                               |
| **Salida**                            | Objeto JSON estable por tool, p. ej. `{ ok: true, path: "<resolved>", ... }` o `{ ok: false, error: { code: "...", message: "..." }, path?: "..." }`. Incluir siempre la ruta resuelta cuando aplique para depuración humana.                                                                                                                                                                                                         |


## Textos de catálogo: descripciones propuestas (sin ambigüedad)

Las cadenas `description` van en **inglés** (como el resto del catálogo) para el modelo; `displayName` / `displayDescription` en **español** para ajustes y onboarding. Incluyen: cuándo usar, cuándo no, proceso, y forma del resultado.

### `read_file`

- `**description` (modelo):**
Reads an existing **text file** under the configured workspace root. Use this when you need to inspect source code, config, logs, or any UTF-8 text without changing it. Do **not** use this to create or modify files; use `write_file` or `edit_file` instead. Do **not** use this if you only need a directory listing (this tool does not list folders).
**Parameters:** `path` is relative to the workspace root (no `..`). Optional `offset` is the **1-based start line number** (first line is `1`). Optional `limit` is the **maximum number of lines** to return starting at `offset`. If both `offset` and `limit` are omitted, the tool reads from the beginning up to a server-enforced maximum size. Binary files are not supported; content is read as UTF-8 text.
**Process:** Resolve and validate `path` → read from disk → optionally slice by line range → return structured JSON.
**Successful output:** `{ "ok": true, "tool": "read_file", "path": "<resolved>", "content": "<text>", "startLine": <number>, "endLine": <number>, "totalLines": <number> }` (exact field names can match implementation; the model must receive the file text in `content` and line metadata so it knows what was returned).
**Failure output:** `{ "ok": false, "tool": "read_file", "path": "<resolved or requested>", "error": { "code": "<short_code>", "message": "<human-readable explanation, e.g. file not found, path outside root, file too large>" } }`.
- `**displayName`:** `Leer archivo`
- `**displayDescription`:** `Lee un archivo de texto existente dentro del workspace (opcionalmente por rango de líneas). No crea ni modifica archivos.`

---

### `write_file`

- `**description` (modelo):**
Creates a **new file** with the given UTF-8 `content`. Use this only when the file must **not** exist yet (first-time creation). If the file already exists, this tool **fails** by design—you must use `edit_file` to change existing files. Do not use this to overwrite or patch; that is always an error for this tool.
**Parameters:** `path` relative to the workspace root; `content` is the full file body to write.
**Process:** Resolve and validate `path` → verify the file does not already exist → create parent directories if the chosen policy allows (or fail if parents are missing—must match implementation) → write bytes atomically when possible → return JSON.
**Successful output:** `{ "ok": true, "tool": "write_file", "path": "<resolved>", "bytesWritten": <number> }`.
**Failure output:** `{ "ok": false, "tool": "write_file", "path": "...", "error": { "code": "...", "message": "..." } }` with explicit reasons, e.g. file already exists, path invalid, parent directory missing, permission denied, or tool disabled.
**Human approval:** This tool mutates disk and runs only after user confirmation in the UI.
- `**displayName`:** `Crear archivo`
- `**displayDescription`:** `Crea un archivo nuevo con contenido completo. Falla si el archivo ya existe; para cambios usa editar archivo.`

---

### `edit_file`

- `**description` (modelo):**
Edits an **existing** UTF-8 text file by replacing **exactly one** occurrence of `old_string` with `new_string`. Use this when you need to update part of a file without rewriting the whole file. Do **not** use this to create a new file (use `write_file`). Do **not** use this if `old_string` might match zero or multiple places—fix the string so it matches **uniquely**, or perform multiple sequential calls with more specific context in `old_string`.
**Parameters:** `path` relative to the workspace root; `old_string` and `new_string` are literal substrings (not regex). Line endings in the file must match what you pass in `old_string` (e.g. include `\n` if needed).
**Process:** Resolve and validate `path` → read file → count occurrences of `old_string` → if not exactly one, fail with a clear message (0 vs many matches) → apply single replacement → write back safely → return JSON.
**Successful output:** `{ "ok": true, "tool": "edit_file", "path": "<resolved>", "replacements": 1 }` (optionally include a short diff summary or line numbers if implementation provides it).
**Failure output:** `{ "ok": false, "tool": "edit_file", "path": "...", "error": { "code": "...", "message": "..." } }` e.g. file not found, `old_string` found 0 times, found more than once, path is a directory, permission denied, or tool disabled.
**Human approval:** This tool mutates disk and runs only after user confirmation in the UI.
- `**displayName`:** `Editar archivo`
- `**displayDescription`:** `Reemplaza una única aparición de un fragmento en un archivo existente. No crea archivos nuevos.`

---

### Notas de implementación para las descripciones

- Repetir en `parameters_schema` (JSON Schema del catálogo) las mismas reglas que en el párrafo del modelo (`offset`/`limit` 1-based lines, `write_file` solo si no existe, `edit_file` unicidad de `old_string`).
- Opcional: añadir `.describe(...)` en Zod en `[schemas.ts](packages/agent/src/tools/schemas.ts)` con frases cortas alineadas a lo anterior para refuerzo en tiempo de invocación.

## Archivos a tocar

- `**[packages/types/src/catalog.ts](packages/types/src/catalog.ts)`**: Tres entradas nuevas con `parameters_schema` alineado al Zod (path, offset/limit opcionales, content, old_string/new_string).
- `**[packages/agent/src/tools/schemas.ts](packages/agent/src/tools/schemas.ts)`**: Tres objetos Zod; límites razonables (`.max()` en strings, números positivos para limit).
- **Nuevo módulo** p. ej. `[packages/agent/src/tools/fileTools.ts](packages/agent/src/tools/fileTools.ts)`: `resolveSafePath`, `executeReadFile`, `executeWriteFile`, `executeEditFile` usando `node:fs/promises` / `node:path`; toda la lógica de errores y mensajes en un solo sitio.
- `**[packages/agent/src/tools/adapters.ts](packages/agent/src/tools/adapters.ts)`**: Registrar los tres handlers en `TOOL_HANDLERS`.
- `**[packages/agent/src/graph.ts](packages/agent/src/graph.ts)`**: Ampliar `buildConfirmationMessage` para `write_file` y `edit_file` (path resumido; truncar `content`/`new_string` en preview si hace falta).
- `**[apps/web/src/app/onboarding/wizard.tsx](apps/web/src/app/onboarding/wizard.tsx)`**: Añadir los tres `id` al array `TOOL_IDS` (el settings ya itera todo el catálogo; el wizard necesita la lista explícita para el upsert inicial).
- `**[apps/web/.env.example](apps/web/.env.example)**`: Documentar `FILE_TOOLS_ROOT` (y opcionalmente `FILE_TOOLS_ENABLED=true` si se adopta flag fail-closed).

No hace falta migración SQL: las filas de `user_tool_settings` se crean al guardar ajustes / onboarding.

## Pruebas manuales sugeridas

- Raíz válida + `read_file` con y sin offset/limit; archivo inexistente → `ok: false` claro.
- `write_file` en path nuevo → `ok: true`; segundo intento mismo path → error “ya existe”.
- `edit_file` con un solo match → `ok: true`; cero o dos matches → error explícito.
- Herramientas mutadoras: flujo HITL muestra mensaje en español y solo escribe tras aprobar.

