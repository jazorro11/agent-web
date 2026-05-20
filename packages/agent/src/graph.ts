import {
  StateGraph,
  interrupt,
  Command,
  INTERRUPT,
} from "@langchain/langgraph";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  defaultToolCallParser,
  type BaseMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { DbClient } from "@agents/db";
import type { UserToolSetting, UserIntegration, PendingConfirmation } from "@agents/types";
import {
  TOOL_CATALOG,
  toolRequiresConfirmation,
  getToolRisk,
} from "@agents/types";
import { createChatModel } from "./model";
import { buildLangChainTools, TOOL_HANDLERS } from "./tools/adapters";
import type { ToolContext } from "./tools/adapters";
import {
  addMessage,
  createToolCall,
  updateToolCallStatus,
  findExistingPendingToolCall,
} from "@agents/db";
import { getCheckpointer } from "./checkpointer";
import { GraphState } from "./state";
import { compactionNode } from "./nodes/compaction_node";
import { createMemoryInjectionNode } from "./nodes/memory_injection_node";
import { createLangfuseRunnableConfig } from "./langfuse";


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
}

export type AgentResponseType = "message" | "pending_confirmation";

export interface AgentOutput {
  /** Explicit outcome for clients — do not infer from free-text `response`. */
  responseType: AgentResponseType;
  response: string;
  toolCalls: string[];
  pendingConfirmation?: PendingConfirmation;
}

/** Confirmation message shown to the human for a given tool + args. */
function buildConfirmationMessage(
  toolId: string,
  args: Record<string, unknown>
): string {
  switch (toolId) {
    case "github_create_issue":
      return `Se requiere confirmación para crear el issue "${args.title}" en ${args.owner}/${args.repo}.`;
    case "github_create_repo":
      return `Se requiere confirmación para crear el repositorio "${args.name}"${args.isPrivate ? " (privado)" : ""}.`;
    case "write_file": {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      const preview = content.length > 300 ? `${content.slice(0, 300)}…` : content;
      return `Se requiere confirmación para crear el archivo \`${path}\` con el siguiente contenido:\n\`\`\`\n${preview}\n\`\`\``;
    }
    case "edit_file": {
      const path = String(args.path ?? "");
      const oldStr = String(args.old_string ?? "");
      const newStr = String(args.new_string ?? "");
      const oldPreview = oldStr.length > 200 ? `${oldStr.slice(0, 200)}…` : oldStr;
      const newPreview = newStr.length > 200 ? `${newStr.slice(0, 200)}…` : newStr;
      return `Se requiere confirmación para editar \`${path}\`.\n\n**Fragmento a reemplazar:**\n\`\`\`\n${oldPreview}\n\`\`\`\n\n**Nuevo contenido:**\n\`\`\`\n${newPreview}\n\`\`\``;
    }
    case "bash": {
      const prompt = String(args.prompt ?? "");
      const preview = prompt.length > 200 ? `${prompt.slice(0, 200)}…` : prompt;
      const terminal = args.terminal ? ` en terminal "${args.terminal}"` : "";
      return `Se requiere confirmación para ejecutar el siguiente comando bash${terminal}:\n\`\`\`\n${preview}\n\`\`\``;
    }
    case "schedule_task": {
      const {
        name,
        description,
        scheduleType,
        priority,
        maxRetries,
        cronExpr,
        runAt,
        timezone,
        tags
      } = args as any;

      const scheduleInfo = scheduleType === "one_time"
        ? `one-time: ${new Date(runAt).toLocaleString("es-CO")}`
        : `recurring: ${cronExpr}`;

      const priorityMap: Record<string, string> = {
        low: "🟢",
        medium: "🟡",
        high: "🔴"
      };
      const priorityEmoji = priorityMap[String(priority)] || "🟡";

      const tagsStr = Array.isArray(tags) && tags.length > 0
        ? tags.join(", ")
        : "none";

      return `
Se requiere confirmación para programar una tarea:

📋 **${name}**
${description ? `   ${description}\n` : ""}
⏱️ Cuándo: ${scheduleInfo}
🌍 Timezone: ${timezone}
${priorityEmoji} Prioridad: ${priority}
🔄 Reintentos: ${maxRetries} (si falla)
🏷️ Tags: ${tagsStr}

¿Aprobar esta tarea?
  `.trim();
    }
    case "google_calendar_create_event": {
      const cal = args.calendarId ? String(args.calendarId) : "primary";
      const attendees = Array.isArray(args.attendees)
        ? (args.attendees as string[]).join(", ")
        : "";
      return `Se requiere confirmación para crear el evento **"${args.summary}"** en el calendario \`${cal}\`.\n\n**Inicio:** \`${JSON.stringify(args.start)}\`\n**Fin:** \`${JSON.stringify(args.end)}\`${attendees ? `\n**Asistentes:** ${attendees}` : ""}`;
    }
    case "google_calendar_update_event": {
      const cal = args.calendarId ? String(args.calendarId) : "primary";
      const keys = ["summary", "description", "location", "start", "end", "attendees"].filter(
        (k) => args[k] !== undefined
      );
      return `Se requiere confirmación para actualizar el evento \`${args.eventId}\` (calendario \`${cal}\`).\n\n**Campos a cambiar:** ${keys.length ? keys.join(", ") : "(ninguno)"}`;
    }
    case "google_calendar_delete_event": {
      const cal = args.calendarId ? String(args.calendarId) : "primary";
      return `Se requiere confirmación para **eliminar de forma irreversible** el evento \`${args.eventId}\` del calendario \`${cal}\`.`;
    }
    case "notion_create_page": {
      const parentLabel =
        args.parent_type === "database" ? "base de datos" : "página";
      return `Se requiere confirmación para crear la página **"${args.title}"** en la ${parentLabel} \`${args.parent_id}\` de Notion.`;
    }
    default:
      return `Se requiere confirmación para ejecutar "${toolId}" (riesgo: ${getToolRisk(toolId)}).`;
  }
}

const MAX_TOOL_ITERATIONS = 6;

/**
 * Checkpoint serde (and historically duplicate `@langchain/core` installs in
 * monorepos) can yield objects where `instanceof AIMessage` is false while the
 * role is still `"ai"`. Rebuild with *this* module's `AIMessage` so tool_calls
 * parsers run consistently.
 */
function toLocalAIMessage(m: BaseMessage): AIMessage | null {
  if (m instanceof AIMessage) return m;
  if (typeof m !== "object" || m === null) return null;
  const anyM = m as { type?: string; _getType?: () => string };
  const role = anyM.type ?? (typeof anyM._getType === "function" ? anyM._getType() : undefined);
  if (role !== "ai") return null;
  const src = m as AIMessage;
  return new AIMessage({
    content: src.content,
    tool_calls: src.tool_calls ?? [],
    invalid_tool_calls: src.invalid_tool_calls ?? [],
    additional_kwargs: { ...(src.additional_kwargs ?? {}) },
    response_metadata: { ...(src.response_metadata ?? {}) },
    id: src.id,
    name: src.name,
    usage_metadata: src.usage_metadata,
  });
}

/**
 * Checkpoint serde can hydrate an AIMessage where the provider still "sees"
 * tool calls (e.g. in `additional_kwargs`, v1 `content` blocks) but `.tool_calls`
 * stayed empty — so `toolExecutorNode` returned {} and the next `agent` invoke
 * hit OpenAI's "tool_calls without tool messages" validation. Re-instantiating
 * runs the AIMessage constructor parsers on all supported shapes.
 */
function coerceAiMessageToolCalls(m: BaseMessage): BaseMessage {
  const ai = toLocalAIMessage(m);
  if (!ai) return m;
  if (ai.tool_calls?.length) return ai;
  return new AIMessage({
    content: ai.content,
    tool_calls: ai.tool_calls,
    invalid_tool_calls: ai.invalid_tool_calls,
    additional_kwargs: { ...ai.additional_kwargs },
    response_metadata: { ...ai.response_metadata },
    id: ai.id,
    name: ai.name,
    usage_metadata: ai.usage_metadata,
  });
}

/** Raw OpenAI-format tool_calls arrays can survive on `lc_kwargs` or serialized kwargs after checkpoint. */
function gatherOpenAiRawToolCallsArray(ai: AIMessage): unknown[] {
  const fromDirect = ai.additional_kwargs?.tool_calls;
  if (Array.isArray(fromDirect) && fromDirect.length > 0) return fromDirect;
  const lk = (
    ai as unknown as {
      lc_kwargs?: { additional_kwargs?: { tool_calls?: unknown[] }; tool_calls?: unknown[] };
    }
  ).lc_kwargs;
  if (lk) {
    if (Array.isArray(lk.tool_calls) && lk.tool_calls.length > 0) return lk.tool_calls;
    const nested = lk.additional_kwargs?.tool_calls;
    if (Array.isArray(nested) && nested.length > 0) return nested;
  }
  if (typeof ai.toJSON === "function") {
    try {
      const serialized = ai.toJSON() as {
        kwargs?: { additional_kwargs?: { tool_calls?: unknown[] } };
      };
      const t = serialized?.kwargs?.additional_kwargs?.tool_calls;
      if (Array.isArray(t) && t.length > 0) return t;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function parseOpenAiToolCallsArray(rawArr: unknown[]): Array<{
  id: string;
  name: string;
  args: Record<string, unknown>;
}> {
  if (!rawArr.length) return [];
  try {
    const [parsed] = defaultToolCallParser(rawArr as never);
    if (parsed?.length) {
      return parsed
        .map((tc) => ({
          id: String(tc.id ?? ""),
          name: String(tc.name),
          args: (tc.args as Record<string, unknown>) ?? {},
        }))
        .filter((tc) => tc.id && tc.name);
    }
  } catch {
    /* fall through to manual parse */
  }
  const out: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  for (const t of rawArr) {
    if (typeof t !== "object" || t === null) continue;
    const row = t as { id?: string; function?: { name?: string; arguments?: string } };
    let args: Record<string, unknown> = {};
    if (row.function?.arguments) {
      try {
        args = JSON.parse(row.function.arguments) as Record<string, unknown>;
      } catch {
        args = {};
      }
    }
    const id = String(row.id ?? "");
    const name = String(row.function?.name ?? "");
    if (id && name) out.push({ id, name, args });
  }
  return out;
}

/** Parsed tool invocations for executor / routing (OpenAI `additional_kwargs` shape + v1 blocks). */
function listPendingToolCallsFromMessage(lastRaw: BaseMessage): Array<{
  id: string;
  name: string;
  args: Record<string, unknown>;
}> {
  const ai0 = toLocalAIMessage(lastRaw);
  if (!ai0) return [];
  const coerced = coerceAiMessageToolCalls(ai0);
  if (coerced instanceof AIMessage && coerced.tool_calls?.length) {
    return coerced.tool_calls
      .map((tc) => ({
        id: String(tc.id ?? ""),
        name: String(tc.name),
        args: (tc.args as Record<string, unknown>) ?? {},
      }))
      .filter((tc) => tc.id && tc.name);
  }
  const ai = coerced instanceof AIMessage ? coerced : ai0;
  const fromOpenAi = parseOpenAiToolCallsArray(gatherOpenAiRawToolCallsArray(ai));
  if (fromOpenAi.length > 0) return fromOpenAi;
  const c = ai.content;
  if (Array.isArray(c) && c.length > 0) {
    const out: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    for (const b of c) {
      if (typeof b !== "object" || b === null) continue;
      const block = b as { type?: string; id?: string; name?: string; args?: Record<string, unknown> };
      if (block.type === "tool_call" && block.id && block.name) {
        out.push({
          id: String(block.id),
          name: String(block.name),
          args: block.args ?? {},
        });
      }
    }
    return out;
  }
  return [];
}

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  const {
    message,
    resumeDecision,
    userId,
    sessionId,
    systemPrompt,
    db,
    enabledTools,
    integrations,
    githubToken,
    googleToken,
    notionToken,
    bypassConfirmation = false,
  } = input;

  const model = createChatModel();
  const toolCtx: ToolContext = {
    db,
    userId,
    sessionId,
    enabledTools,
    integrations,
    githubToken,
    googleToken,
    notionToken,
  };
  const lcTools = buildLangChainTools(toolCtx);

  const modelWithTools = lcTools.length > 0 ? model.bindTools(lcTools) : model;

  const toolCallNames: string[] = [];

  async function agentNode(
    state: typeof GraphState.State,
    config?: RunnableConfig
  ): Promise<Partial<typeof GraphState.State>> {
    const lastAwaitingTools = state.messages[state.messages.length - 1];
    if (listPendingToolCallsFromMessage(lastAwaitingTools).length > 0) {
      return new Command({ goto: "tools" }) as unknown as Partial<typeof GraphState.State>;
    }
    const currentDate = new Date().toLocaleString("es", {
      timeZone: "America/Bogota",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const systemPromptWithDate = `${state.systemPrompt}\n\nFecha y hora actual: ${currentDate} (hora Colombia).`;

    // Inject SystemMessage fresh so it is never accumulated in state.messages.
    const messagesForModel = state.messages.map((m) => coerceAiMessageToolCalls(m));
    const response = await modelWithTools.invoke(
      [
        new SystemMessage(systemPromptWithDate),
        ...messagesForModel,
      ],
      config
    );
    return { messages: [response] };
  }

  async function toolExecutorNode(
    state: typeof GraphState.State,
    config?: RunnableConfig
  ): Promise<Partial<typeof GraphState.State>> {
    const lastRaw = state.messages[state.messages.length - 1];
    const pending = listPendingToolCallsFromMessage(lastRaw);
    if (!pending.length) {
      return {};
    }

    const results: BaseMessage[] = [];

    for (const tc of pending) {
      const def = TOOL_CATALOG.find((t) => t.name === tc.name);
      const toolId = def?.id ?? tc.name;
      toolCallNames.push(tc.name);

      if (def && toolRequiresConfirmation(toolId)) {
        if (bypassConfirmation) {
          // Unattended run (e.g. cron): auto-approve without interrupting.
          const record = await createToolCall(db, sessionId, toolId, tc.args as Record<string, unknown>, true);
          await updateToolCallStatus(db, record.id, "approved");

          const autoHandler = TOOL_HANDLERS[toolId];
          try {
            const result = await autoHandler(tc.args as Record<string, unknown>, toolCtx);
            await updateToolCallStatus(db, record.id, "executed", result);
            results.push(new ToolMessage({ content: JSON.stringify(result), tool_call_id: tc.id! }));
          } catch (err) {
            const errResult = { error: String(err) };
            await updateToolCallStatus(db, record.id, "failed", errResult);
            results.push(new ToolMessage({ content: JSON.stringify(errResult), tool_call_id: tc.id! }));
          }
          continue;
        }

        // Idempotent: on graph replay after resume the record already exists.
        let record = await findExistingPendingToolCall(db, sessionId, toolId);
        if (!record) {
          record = await createToolCall(db, sessionId, toolId, tc.args as Record<string, unknown>, true);
        }

        const confirmMsg = buildConfirmationMessage(toolId, tc.args as Record<string, unknown>);

        // interrupt() pauses graph execution here on first pass.
        // On resume, it returns the decision value immediately.
        const decision = interrupt({
          tool_call_id: record.id,
          tool_name: toolId,
          message: confirmMsg,
          args: tc.args,
        }) as "approve" | "reject";

        if (decision !== "approve") {
          await updateToolCallStatus(db, record.id, "rejected");
          results.push(
            new ToolMessage({
              content: "Acción cancelada por el usuario.",
              tool_call_id: tc.id!,
            })
          );
          continue;
        }

        await updateToolCallStatus(db, record.id, "approved");

        // Call the handler directly to avoid withTracking creating a second DB record.
        const confirmedHandler = TOOL_HANDLERS[toolId];
        try {
          const result = await confirmedHandler(tc.args as Record<string, unknown>, toolCtx);
          await updateToolCallStatus(db, record.id, "executed", result);
          results.push(new ToolMessage({ content: JSON.stringify(result), tool_call_id: tc.id! }));
        } catch (err) {
          const errResult = { error: String(err) };
          await updateToolCallStatus(db, record.id, "failed", errResult);
          results.push(new ToolMessage({ content: JSON.stringify(errResult), tool_call_id: tc.id! }));
        }
        continue;
      }

      // Execute non-confirmed tools (withTracking handles DB record creation).
      const matchingTool = lcTools.find((t) => t.name === tc.name);
      if (!matchingTool) {
        results.push(
          new ToolMessage({
            content: JSON.stringify({ error: `Tool '${tc.name}' not available` }),
            tool_call_id: tc.id!,
          })
        );
        continue;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawResult = await (matchingTool as any).invoke(tc.args, config);
        results.push(
          new ToolMessage({ content: String(rawResult), tool_call_id: tc.id! })
        );
      } catch (err) {
        results.push(
          new ToolMessage({
            content: JSON.stringify({ error: String(err) }),
            tool_call_id: tc.id!,
          })
        );
      }
    }

    return { messages: results };
  }

  function shouldContinue(state: typeof GraphState.State): string {
    const lastRaw = state.messages[state.messages.length - 1];
    if (listPendingToolCallsFromMessage(lastRaw).length > 0) {
      const iterations = state.messages.filter((m) => {
        const loc = toLocalAIMessage(m);
        if (!loc) return false;
        return Boolean(loc.tool_calls?.length) || listPendingToolCallsFromMessage(m).length > 0;
      }).length;
      if (iterations >= MAX_TOOL_ITERATIONS) return "end";
      return "tools";
    }
    return "end";
  }

  /** After compaction, run tools before agent when the checkpoint tail is an assistant turn awaiting tool results. */
  function routeCompactionNext(state: typeof GraphState.State): "agent" | "tools" {
    const last = state.messages[state.messages.length - 1];
    return listPendingToolCallsFromMessage(last).length > 0 ? "tools" : "agent";
  }

  const memoryInjectionNode = createMemoryInjectionNode({ db, userId });

  const graph = new StateGraph(GraphState)
    .addNode("memory_injection", memoryInjectionNode)
    .addNode("compaction", compactionNode)
    .addNode("agent", agentNode)
    .addNode("tools", toolExecutorNode)
    .addEdge("__start__", "memory_injection")
    .addEdge("memory_injection", "compaction")
    .addConditionalEdges("compaction", routeCompactionNext, {
      agent: "agent",
      tools: "tools",
    })
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      end: "__end__",
    })
    .addEdge("tools", "compaction");

  const checkpointer = await getCheckpointer();
  const app = graph.compile({ checkpointer });

  const langfuseConfig = createLangfuseRunnableConfig({
    userId,
    sessionId,
    runName: resumeDecision ? "agent-confirmation" : "agent-message",
    tags: [
      "10x-builders-agent",
      bypassConfirmation ? "cron" : "interactive",
      resumeDecision ? "resume" : "message",
    ],
    metadata: {
      agentSessionId: sessionId,
      bypassConfirmation,
    },
  });
  const config: RunnableConfig = {
    ...langfuseConfig,
    configurable: { thread_id: sessionId },
  };

  let finalState: typeof GraphState.State & { [INTERRUPT]?: unknown[] };

  if (resumeDecision) {
    // Resume interrupted graph with human decision
    finalState = await app.invoke(
      new Command({ resume: resumeDecision }),
      config
    );
  } else {
    // New message — persist to DB (audit log) then append to checkpointer state.
    // The checkpointer is the sole source of truth for message history; we never
    // reconstruct from DB to avoid duplicating messages across invocations.
    await addMessage(db, sessionId, "user", message!);

    // Wrap the user-controlled system prompt in XML delimiters to prevent
    // prompt injection from influencing the model's core instructions.
    const wrappedSystemPrompt = `<user_persona>\n${systemPrompt}\n</user_persona>`;
    finalState = await app.invoke(
      { messages: [new HumanMessage(message!)], sessionId, userId, systemPrompt: wrappedSystemPrompt },
      config
    );
  }

  // Check if the graph is paused at an interrupt
  const interrupts = (finalState as Record<string, unknown>)[INTERRUPT] as
    | Array<{ value: unknown }>
    | undefined;

  if (interrupts?.length) {
    const interruptValue = interrupts[0].value as {
      tool_call_id: string;
      tool_name: string;
      message: string;
      args: Record<string, unknown>;
    };

    const pendingConfirmation: PendingConfirmation = {
      kind: "human_approval",
      tool_call_id: interruptValue.tool_call_id,
      tool_name: interruptValue.tool_name,
      message: interruptValue.message,
      args: interruptValue.args,
    };

    // Persist the pending confirmation so it survives page refresh.
    await addMessage(db, sessionId, "assistant", interruptValue.message, {
      structured_payload: {
        type: "pending_confirmation",
        kind: "human_approval",
        tool_call_id: pendingConfirmation.tool_call_id,
        tool_name: pendingConfirmation.tool_name,
        message: pendingConfirmation.message,
        args: pendingConfirmation.args,
      },
    });

    return {
      responseType: "pending_confirmation",
      response: interruptValue.message,
      toolCalls: toolCallNames,
      pendingConfirmation,
    };
  }

  // Normal completion
  const lastMessage = finalState.messages[finalState.messages.length - 1];
  const responseText =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

  await addMessage(db, sessionId, "assistant", responseText);

  return {
    responseType: "message",
    response: responseText,
    toolCalls: toolCallNames,
  };
}
