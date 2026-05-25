# Demo Onboarding: diseño de mejoras

Fecha: 2026-05-24

## Contexto

El demo actual permite a cualquier visitante probar el agente sin registrarse. El flujo es: login con sesion efimera de 20 minutos, wizard de 4 pasos, chat. El problema principal es que el usuario llega al chat sin entender que puede pedirle al agente, y el wizard no explica los casos de uso de cada herramienta.

## Alcance

Mejoras al wizard (paso de herramientas), al estado vacio del chat (chips de sugerencia), al system prompt del agente (inyeccion de herramientas activas) y correcciones de texto en toda la UI (guiones largos y flechas).

## Enfoque elegido

Enriquecer lo que existe (Enfoque A): sin pasos nuevos en el wizard, sin cambios estructurales al flujo. Se mejoran componentes existentes.

---

## Seccion 1: Paso de herramientas del wizard

**Archivo:** `apps/web/src/app/onboarding/steps/step-tools.tsx`

### Diseno actual

Lista plana de checkboxes, una entrada por herramienta, con badge de riesgo (bajo, medio, alto). Las herramientas de demo con riesgo medio y alto se muestran deshabilitadas.

### Diseno propuesto

Reorganizar las 17 herramientas en tarjetas por categoria de integracion:

- GitHub (4 herramientas: listar repos, listar issues, crear issue, crear repo)
- Google Calendar (5 herramientas: listar calendarios, listar eventos, crear evento, editar evento, eliminar evento)
- Notion (3 herramientas: buscar, leer pagina, crear pagina)
- Archivos (3 herramientas: leer archivo, crear archivo, editar archivo)
- Utilidades (2 herramientas: preferencias de usuario, listar herramientas)

Cada tarjeta contiene:

1. Nombre de la categoria con icono.
2. Descripcion corta de para que sirve (una oracion).
3. Bloque de ejemplos con 2-3 prompts reales que el usuario puede pedirle al agente.
4. Aviso de integracion requerida cuando aplica ("Requiere conectar GitHub en ajustes").
5. Indicador de cuantas herramientas de esa categoria estan activas.

Para usuarios demo, las categorias que requieren integracion se muestran con un badge "Requiere registro" y sus herramientas aparecen deshabilitadas. Las categorias disponibles en demo (Archivos, Utilidades) se destacan con borde azul y badge "Activa en demo".

Los toggles individuales por herramienta se mantienen dentro de cada tarjeta para que el usuario pueda activar o desactivar herramientas especificas.

### Invariantes

- La logica de guardado (`handleSave` en el wizard) no cambia.
- Los demos siguen recibiendo solo herramientas de riesgo bajo en el servidor.
- El filtrado por `is_demo_user` en `POST /api/chat` no cambia.

---

## Seccion 2: Chips de sugerencia en el chat

**Archivo:** `apps/web/src/app/chat/chat-interface.tsx`

### Diseno actual

Estado vacio muestra: "Hola! Soy {agentName}" y "Escribe un mensaje para comenzar." Sin ejemplos ni acciones sugeridas.

### Diseno propuesto

Cuando la lista de mensajes esta vacia, mostrar:

1. Saludo: "Hola, soy tu agente."
2. Subtitulo: "Prueba alguna de estas acciones o escribe lo que necesitas."
3. Chips clicables generados dinamicamente segun las herramientas activas del usuario, mas uno fijo.

Logica de generacion de chips (maximo 4 chips visibles: 3 dinamicos mas 1 fijo):

- Si GitHub activo: "Lista mis repositorios"
- Si Google Calendar activo: "Eventos de esta semana"
- Si Notion activo: "Busca en Notion"
- Si Archivos activo: "Lee un archivo"
- Siempre presente (cuenta como el cuarto chip): "Que puedes hacer?"

Comportamiento:

- Al hacer clic en un chip, el texto se carga en el input y se envia automaticamente.
- Los chips solo se muestran cuando `messages.length === 0`.
- Los chips desaparecen despues del primer mensaje enviado.
- En modo demo, los chips se ajustan a las herramientas disponibles (sin chips de integraciones que requieren OAuth).

### Invariantes

- El input y el boton de enviar no cambian su comportamiento.
- La restriccion de envio cuando hay `hasPendingConfirmation` se mantiene.

---

## Seccion 3: System prompt enriquecido

**Archivo:** `packages/agent/src/graph.ts`

### Diseno actual

El system prompt incluye solo `<user_persona>` (instrucciones del usuario) y la fecha/hora actual. El agente no conoce sus herramientas activas.

### Diseno propuesto

Despues del bloque `<user_persona>`, inyectar un bloque `<herramientas_activas>` construido a partir de `ctx.enabledTools` y el catalogo de tipos.

**Para usuario registrado con herramientas activas:**

```
<herramientas_activas>
Tienes acceso a las siguientes herramientas:

GitHub: listar repositorios, listar issues.
Google Calendar: listar calendarios, listar eventos, crear y editar eventos.
Archivos: leer archivos de texto.
Utilidades: ver preferencias del usuario, listar herramientas activas.
</herramientas_activas>
```

**Para usuario demo:**

```
<herramientas_activas>
Estas en modo demo. Tienes acceso a herramientas de solo lectura:

Archivos: leer archivos de texto.
Utilidades: ver preferencias del usuario, listar herramientas activas.

Con una cuenta completa puedes conectar GitHub, Google Calendar y Notion
para crear eventos, issues, paginas y ejecutar tareas programadas.
</herramientas_activas>
```

El bloque se omite si `ctx.enabledTools` esta vacio.

La diferenciacion demo vs. usuario registrado se hace con el flag `isDemoUser`. Este flag existe en `POST /api/chat` (route.ts) pero actualmente no se pasa a `runAgent()`. Se debe agregar `isDemoUser: boolean` al objeto de opciones de `runAgent()` en `packages/agent/src/agent.ts` y propagarlo hasta la construccion del system prompt en `graph.ts`.

### Construccion del bloque

La funcion `buildToolsBlock(enabledTools: string[], isDemoUser: boolean): string` se puede implementar en `packages/agent/src/graph.ts` o en un archivo utilitario. Recorre `TOOL_CATALOG` agrupando por `requires_integration` (o por categoria logica definida en el catalogo) y formatea el texto. Si `isDemoUser` es true, usa el texto alternativo con la mencion a la cuenta completa.

### Invariantes

- El bloque es solo lectura para el modelo (el usuario no lo ve ni lo edita).
- No se acumula en el historial de mensajes (se inyecta fresco en cada invocacion, igual que la fecha).
- El bloque no reemplaza las descripciones de las herramientas que ya recibe el modelo via tool definitions.

---

## Seccion 4: Correcciones de texto

### Guiones largos y flechas a eliminar

| Archivo | Linea aprox. | Texto actual | Texto propuesto |
|---|---|---|---|
| `apps/web/src/app/chat/page.tsx` | 115 | "Estas probando el demo — solo herramientas de lectura disponibles." | "Estas probando el demo. Solo herramientas de lectura disponibles." |
| `apps/web/src/app/chat/page.tsx` | 120 | "Registrate para acceso completo →" | "Registrate para acceso completo." |
| `apps/web/src/app/login/page.tsx` | 30 | "Ver demo en vivo →" | "Ver demo en vivo" |
| `apps/web/src/app/settings/settings-form.tsx` | 260 | `displayName — displayDescription` | `displayName: displayDescription` |

### Saludo del chat

Cambiar el saludo del estado vacio de "Hola! Soy {agentName}" a "Hola, soy tu agente." para que funcione con cualquier nombre sin quedar incoherente (especialmente en el demo donde el nombre del agente es el valor por defecto).

---

## Archivos afectados

- `apps/web/src/app/onboarding/steps/step-tools.tsx` (rediseno completo del componente)
- `apps/web/src/app/chat/chat-interface.tsx` (chips en estado vacio, saludo)
- `apps/web/src/app/chat/page.tsx` (texto del banner demo)
- `apps/web/src/app/login/page.tsx` (texto del boton demo)
- `apps/web/src/app/settings/settings-form.tsx` (formato de herramientas)
- `packages/agent/src/graph.ts` (inyeccion del bloque herramientas_activas)

## Archivos de referencia (solo lectura)

- `packages/types/src/catalog.ts` (fuente de verdad: herramientas, riesgos, integraciones)
- `packages/agent/src/tools/adapters.ts` (logica de disponibilidad de herramientas)
- `apps/web/src/app/onboarding/wizard.tsx` (orquestacion del wizard)
