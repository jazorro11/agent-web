---
name: compaction-node-graph
overview: Insertar un compaction_node transparente en el grafo del agente para controlar crecimiento del historial con microcompact + compactación LLM, umbral 80% y circuit breaker, sin modificar la lógica funcional de agent/tools/HITL/checkpointer.
todos:
  - id: extract-graph-state
    content: Extraer/crear state.ts y añadir compactionCount con defaults/reducer consistentes.
    status: pending
  - id: build-compaction-node
    content: Implementar nodes/compaction_node.ts con microcompact, LLM compaction (80%, Haiku, 9 secciones, strip <analysis>) y circuit breaker de 3 fallos.
    status: pending
  - id: rewire-graph-edges
    content: Actualizar graph.ts para __start__->compaction->agent y tools->compaction, preservando shouldContinue e iteration guard.
    status: pending
  - id: wire-compaction-model
    content: Agregar factory de modelo de compactación en model.ts sin afectar el modelo principal del agente.
    status: pending
  - id: verify-behavior
    content: Correr type-check y pruebas manuales del flujo tools->compaction y fallback por fallos consecutivos.
    status: pending
isProject: false
---

# Prompt usado para generar este plan

```
Objetivo
Agregar un compaction_node al grafo existente que gestione automáticamente el crecimiento del historial de mensajes, evitando Context Rot sin perder contexto crítico.

Insights clave
Dos etapas en orden de costo: microcompact primero (gratis, reemplaza tool results viejos con [tool result cleared], preserva los últimos 5), LLM compaction después (solo si supera el 80% de la ventana configurada)
El umbral es 80%, no 95% — se necesita buffer para que la compactación misma quepa en la ventana
El LLM que compacta es Haiku, no Sonnet — es una tarea mecánica, no necesita el modelo más potente
El prompt de compactación genera un resumen de 9 secciones estructuradas. Si el modelo devuelve un bloque <analysis>, se elimina antes de reinyectar — mejora calidad sin gastar tokens extra
Circuit breaker: después de 3 fallos consecutivos, el nodo devuelve los mensajes sin compactar en lugar de hacer loop infinito
El edge crítico es tools → compaction, no tools → agent. Cada tool result nuevo pasa por microcompact antes de llegar al agente


Contexto del grafo actual
__start__ → agent → (conditional) → tools → agent → ... → __end__

State: messages (reducer append), sessionId, userId, systemPrompt
agent_node: llama al LLM con tools bound + system prompt enriquecido con datetime Colombia
tools_node (toolExecutorNode): ejecuta tool calls. Tiene HITL con interrupt() — pausa el grafo y espera aprobación del usuario. bypassConfirmation para cron jobs
Edge condicional agent → tools: solo si hay tool calls Y iterationCount < 6
Checkpointer: persistente por sessionId, es la fuente de verdad del historial

Topología nueva:
__start__ → compaction → agent → (conditional) → tools → compaction → agent → ...
Lo que hay que tocar:

state.ts — agregar campo compactionCount: number
Crear nodes/compaction_node.ts — las dos etapas + circuit breaker
graph.ts — reemplazar edge START → agent por START → compaction, agregar compaction → agent, cambiar tools → agent por tools → compaction

Lo que NO se toca: la lógica del agent_node, el toolExecutorNode, el HITL, el iterationCount, el checkpointer. El compaction_node es transparente para todo lo demás.
```

# Plan de implementación: compaction node en el grafo

## Objetivo

Agregar un `compaction_node` al loop del agente para prevenir Context Rot de forma automática, aplicando dos etapas (microcompact y LLM compaction) y manteniendo intactas las responsabilidades actuales de `agent_node`, `toolExecutorNode`, HITL, `iterationCount` derivado y checkpointer.

## Estado actual observado

- El estado del grafo (`GraphState`) está inline en `[packages/agent/src/graph.ts](packages/agent/src/graph.ts)`, no existe aún `[packages/agent/src/state.ts](packages/agent/src/state.ts)`.
- Topología vigente:
  - `__start__ -> agent -> (tools | __end__)`
  - `tools -> agent`
- El historial se acumula con reducer append en `messages`, y el checkpointer persiste por `sessionId`.

## Topología objetivo

```mermaid
flowchart LR
  startNode[__start__] --> compactionNode
  compactionNode --> agentNode
  agentNode -->|tools| toolsNode
  agentNode -->|end| endNode[__end__]
  toolsNode --> compactionNode
```



## Cambios propuestos

- **Estado del grafo**
  - Crear/extraer `[packages/agent/src/state.ts](packages/agent/src/state.ts)` para centralizar `GraphState`.
  - Agregar `compactionCount: number` con `default: () => 0` (y reducer de reemplazo para evitar acumulación accidental).
  - Importar `GraphState` desde `graph.ts` para mantener contratos tipados consistentes.
- **Nuevo nodo de compactación**
  - Crear `[packages/agent/src/nodes/compaction_node.ts](packages/agent/src/nodes/compaction_node.ts)` con función pura de nodo LangGraph que reciba `state` y retorne `Partial<State>`.
  - Implementar etapa 1 (microcompact, costo 0):
    - Detectar `ToolMessage` antiguos y reemplazar contenido por `"[tool result cleared]"`.
    - Preservar sin limpiar los últimos 5 tool results.
    - Mantener estructura/orden de mensajes (sin alterar semántica de turnos recientes).
  - Implementar etapa 2 (LLM compaction, condicional):
    - Calcular ocupación de ventana y compactar solo cuando supere 80% (no 95%).
    - Invocar modelo “Haiku” para resumir en 9 secciones estructuradas.
    - Sanitizar salida eliminando cualquier bloque `<analysis>...</analysis>` antes de reinyectar.
    - Reinyectar resumen como mensaje de contexto compacto y conservar cola reciente de mensajes para continuidad operativa.
  - Circuit breaker:
    - Llevar contador de fallos consecutivos en `compactionCount`.
    - Si hay 3 fallos seguidos, devolver mensajes sin compactar y resetear flujo al camino normal (evita loops infinitos).
- **Cableado del grafo**
  - En `[packages/agent/src/graph.ts](packages/agent/src/graph.ts)`:
    - Reemplazar `__start__ -> agent` por `__start__ -> compaction`.
    - Agregar `compaction -> agent`.
    - Cambiar `tools -> agent` por `tools -> compaction` (edge crítico).
    - Mantener intacto `shouldContinue` y el guard de `MAX_TOOL_ITERATIONS`.
- **Modelo y configuración para compaction**
  - Extender `[packages/agent/src/model.ts](packages/agent/src/model.ts)` con una factory dedicada para compaction (Haiku), separada de `createChatModel()` para no afectar el modelo principal del agente.
  - Parametrizar ventana máxima y umbral (`0.8`) con constantes en el nodo para control explícito y futura configuración.

## Criterios de aceptación

- Todo resultado de tool pasa por microcompact antes de volver a `agent` (`tools -> compaction -> agent`).
- Microcompact preserva los últimos 5 `ToolMessage` íntegros y limpia los anteriores.
- LLM compaction solo corre por encima de 80% de ventana.
- La salida compactada no contiene bloques `<analysis>`.
- Tras 3 fallos consecutivos de compactación, el nodo hace passthrough sin bloquear el grafo.
- No hay cambios funcionales en HITL, tool execution, checkpointer, ni en la condición de iteraciones.

## Riesgos y mitigación

- Riesgo de estimación imperfecta de ocupación de ventana: usar heurística conservadora (80%) y buffer fijo.
- Riesgo de pérdida de contexto útil en limpieza agresiva: preservar últimos 5 resultados + cola reciente además del resumen estructurado.
- Riesgo de inestabilidad por errores del compactador: circuit breaker + fallback passthrough.

## Validación técnica

- Ejecutar `type-check` en `@agents/agent`.
- Simular conversación con múltiples tool calls y verificar transición de edges esperada.
- Verificar que, al superar umbral, aparece resumen de 9 secciones y no quedan tags `<analysis>`.
- Forzar 3 fallos del compactador (mock/error) y confirmar fallback sin loop.

