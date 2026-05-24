import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { RemoveMessage } from "@langchain/core/messages";
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { createCompactionModel } from "../model";
import type { GraphState } from "../state";

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Conservative character-per-token ratio for heuristic window estimation.
 * We use 4 chars/token (Anthropic averages ~3.5) for a built-in safety margin.
 */
const CHARS_PER_TOKEN = 4;

/** Context window for the primary agent model (gpt-4o-mini). */
const CONTEXT_WINDOW_TOKENS = 128_000;

/** Trigger LLM compaction when history exceeds this fraction of the window. */
const COMPACTION_THRESHOLD = 0.8;

/** Recent ToolMessages to keep intact during microcompact. */
const MICROCOMPACT_KEEP_RECENT = 5;

/** Tail of messages to preserve verbatim after LLM compaction for continuity. */
const COMPACTION_TAIL_SIZE = MICROCOMPACT_KEEP_RECENT * 2;

/** Stop retrying LLM compaction after this many consecutive failures. */
const CIRCUIT_BREAKER_LIMIT = 3;

// ─── Helpers ────────────────────────────────────────────────────────────────

function estimateTokens(messages: BaseMessage[]): number {
  const totalChars = messages.reduce((acc, msg) => {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
    return acc + content.length;
  }, 0);
  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

function occupancyRatio(messages: BaseMessage[]): number {
  return estimateTokens(messages) / CONTEXT_WINDOW_TOKENS;
}

/** Remove <analysis>…</analysis> blocks that models occasionally prepend. */
function stripAnalysisBlock(text: string): string {
  return text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();
}

// ─── Stage 1: Microcompact ───────────────────────────────────────────────────

/**
 * Replaces ToolMessage content with "[tool result cleared]" for old results,
 * preserving the most recent `MICROCOMPACT_KEEP_RECENT` tool results intact.
 * Returns RemoveMessage+replacement pairs consumed by messagesStateReducer.
 *
 * Because messagesStateReducer matches by message ID, we need messages to have
 * stable IDs to remove them. We return the full replacement list so callers can
 * pass it directly to the state update.
 */
function microcompact(messages: BaseMessage[]): BaseMessage[] {
  const toolIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i] instanceof ToolMessage) {
      toolIndices.push(i);
    }
  }

  const keepFrom = Math.max(0, toolIndices.length - MICROCOMPACT_KEEP_RECENT);
  const indicesToClear = new Set(toolIndices.slice(0, keepFrom));

  return messages.map((msg, idx) => {
    if (!indicesToClear.has(idx)) return msg;
    return new ToolMessage({
      content: "[tool result cleared]",
      tool_call_id: (msg as ToolMessage).tool_call_id,
      name: (msg as ToolMessage).name,
      id: msg.id,
    });
  });
}

// ─── Stage 2: LLM Compaction ─────────────────────────────────────────────────

const COMPACTION_PROMPT = `You are a context compactor. Your task is to summarize a conversation into a structured context block that preserves all information the agent needs to continue working correctly.

Produce a structured summary with exactly these 9 sections:

1. **Goal**: The user's primary objective in this conversation.
2. **Progress**: What has been accomplished so far (tools called, files changed, issues created, etc.).
3. **Current State**: The precise state of the work right now (what is done, what is pending).
4. **Key Decisions**: Important choices made during the conversation and the rationale behind them.
5. **Constraints & Requirements**: Rules, limitations, or requirements the agent must respect.
6. **Tool Calls Summary**: A concise record of tools invoked and their outcomes.
7. **Open Questions**: Unresolved questions or ambiguities that may affect next steps.
8. **Next Steps**: What the agent should do next to continue progressing toward the goal.
9. **User Preferences**: Tone, language, style, or other preferences the user has expressed.

Rules:
- Be dense and precise. Omit pleasantries, verbose explanations, and filler.
- Preserve exact values (IDs, file paths, repo names, dates, cron expressions, etc.).
- Do NOT include an <analysis> block.
- Output only the 9-section summary, nothing else.`;

async function llmCompact(
  messages: BaseMessage[],
  config?: RunnableConfig
): Promise<string> {
  const model = createCompactionModel();

  const transcript = messages
    .filter((m) => !(m instanceof SystemMessage))
    .map((m) => {
      const role =
        m instanceof HumanMessage
          ? "Human"
          : m instanceof AIMessage
          ? "Assistant"
          : m instanceof ToolMessage
          ? `Tool[${(m as ToolMessage).tool_call_id}]`
          : "System";
      const content =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `[${role}]: ${content}`;
    })
    .join("\n\n");

  const response = await model.invoke(
    [
      new SystemMessage(COMPACTION_PROMPT),
      new HumanMessage(
        `Conversation to summarize:\n\n${transcript}\n\nProvide the structured 9-section summary now.`
      ),
    ],
    config
  );

  const raw =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  return stripAnalysisBlock(raw);
}

// ─── Node ────────────────────────────────────────────────────────────────────

export async function compactionNode(
  state: typeof GraphState.State,
  config?: RunnableConfig
): Promise<Partial<typeof GraphState.State>> {
  const { messages, compactionCount } = state;

  // ── Stage 1: Microcompact (always runs, zero cost) ───────────────────────
  const afterMicro = microcompact(messages);

  // ── Circuit breaker: skip LLM compaction after repeated failures ─────────
  if (compactionCount >= CIRCUIT_BREAKER_LIMIT) {
    return { messages: afterMicro };
  }

  // ── Stage 2: LLM compaction (only if above threshold) ────────────────────
  const ratio = occupancyRatio(afterMicro);
  if (ratio < COMPACTION_THRESHOLD) {
    return { messages: afterMicro };
  }

  // Keep enough messages to preserve tool call/response pairs intact.
  // Scan backwards from the end to find a safe split point that doesn't separate
  // an AIMessage(tool_calls) from its following ToolMessages.
  let tailStartIdx = afterMicro.length - COMPACTION_TAIL_SIZE;

  // Scan back to find an AIMessage with tool_calls or a point before any pending pairs
  while (tailStartIdx > 0) {
    const msg = afterMicro[tailStartIdx];
    // If we're at an AIMessage with tool_calls, we MUST include all following ToolMessages
    if (msg instanceof AIMessage && msg.tool_calls?.length) {
      // Advance tailStartIdx past all immediately following ToolMessages
      let idx = tailStartIdx + 1;
      while (idx < afterMicro.length && afterMicro[idx] instanceof ToolMessage) {
        idx++;
      }
      tailStartIdx = idx;
      break;
    }
    // Also check if we're in the middle of a tool call sequence
    // (AIMessage followed by ToolMessages) - if so, back up to before the AIMessage
    if (msg instanceof ToolMessage) {
      let idx = tailStartIdx - 1;
      while (idx >= 0 && !(afterMicro[idx] instanceof AIMessage)) {
        idx--;
      }
      if (idx >= 0 && afterMicro[idx] instanceof AIMessage && (afterMicro[idx] as AIMessage).tool_calls?.length) {
        tailStartIdx = idx;
        break;
      }
    }
    tailStartIdx--;
  }

  // Ensure we still have a tail (don't compress everything)
  if (tailStartIdx >= afterMicro.length - 2) {
    tailStartIdx = Math.max(0, afterMicro.length - COMPACTION_TAIL_SIZE);
  }

  const tail = afterMicro.slice(tailStartIdx);
  const toSummarize = afterMicro.slice(0, tailStartIdx);

  try {
    const summary = await llmCompact(toSummarize, config);

    const summaryMsg = new SystemMessage(
      `[CONTEXT SUMMARY — previous conversation compacted]\n\n${summary}`
    );

    // REMOVE_ALL_MESSAGES clears the entire history, then we append the
    // compacted summary + tail. This is the idiomatic LangGraph replace pattern.
    const replaceSignal = new RemoveMessage({ id: REMOVE_ALL_MESSAGES });

    return {
      messages: [replaceSignal, summaryMsg, ...tail],
      compactionCount: 0,
    };
  } catch {
    // On failure, increment the breaker counter and return microcompacted messages.
    return {
      messages: afterMicro,
      compactionCount: compactionCount + 1,
    };
  }
}
