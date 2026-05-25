"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { PendingConfirmation } from "@agents/types";
import { getChips } from "./chip-suggestions";

/* ─── Inline markdown renderer ─── */
type MdSeg = { t: "h" | "li" | "link" | "bold" | "text" | "br"; c: string; href?: string };

function parseMd(text: string): MdSeg[] {
  const out: MdSeg[] = [];
  for (const line of text.split("\n")) {
    if (/^#{1,6}\s/.test(line)) {
      out.push({ t: "h", c: line.replace(/^#{1,6}\s/, "") });
    } else if (line.startsWith("- ") || /^\d+\.\s/.test(line)) {
      out.push({ t: "li", c: line.replace(/^-\s|^\d+\.\s/, "") });
    } else if (line.trim() === "") {
      out.push({ t: "br", c: "" });
    } else {
      out.push(...parseInline(line));
    }
  }
  return out;
}

function parseInline(text: string): MdSeg[] {
  const segs: MdSeg[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ t: "text", c: text.slice(last, m.index) });
    if (m[1]) segs.push({ t: "link", c: m[1], href: m[2] });
    else if (m[3]) segs.push({ t: "bold", c: m[3] });
    last = re.lastIndex;
  }
  if (last < text.length) segs.push({ t: "text", c: text.slice(last) });
  return segs.length ? segs : [{ t: "text", c: text }];
}

function renderSeg(s: MdSeg, key: string) {
  switch (s.t) {
    case "link":
      return <a key={key} href={s.href} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline", wordBreak: "break-all" }}>{s.c}</a>;
    case "bold":
      return <strong key={key} style={{ fontWeight: "bold" }}>{s.c}</strong>;
    case "br":
      return <br key={key} />;
    default:
      return <span key={key}>{s.c}</span>;
  }
}

function inlineContent(raw: string, prefix: string) {
  return parseInline(raw).map((seg, j) => renderSeg(seg, `${prefix}-${j}`));
}

function RenderMd({ content }: { content: string }) {
  const segs = useMemo(() => parseMd(content), [content]);
  return (
    <div style={{ wordBreak: "break-word", overflowWrap: "break-word" }}>
      {segs.map((s, i) => {
        switch (s.t) {
          case "h":
            return <h3 key={i} style={{ fontSize: "1rem", fontWeight: "bold", margin: "0.5rem 0" }}>{inlineContent(s.c, String(i))}</h3>;
          case "li":
            return <div key={i} style={{ marginLeft: "1rem", margin: "0.25rem 0" }}>• {inlineContent(s.c, String(i))}</div>;
          default:
            return renderSeg(s, String(i));
        }
      })}
    </div>
  );
}

interface Message {
  role: string;
  content: string;
  created_at?: string;
  confirmation?: PendingConfirmation;
  confirmationStatus?: "pending" | "approved" | "rejected";
}

interface SessionItem {
  id: string;
  created_at: string;
  last_used_at: string;
  status: string;
}

interface Props {
  agentName: string;
  initialMessages: Array<{ role: string; content: string; created_at?: string; structured_payload?: Record<string, unknown> }>;
  sessions: SessionItem[];
  currentSessionId: string | null;
  initialPendingConfirmation: PendingConfirmation | null;
  enabledTools: string[];
}

function formatSessionDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function buildInitialMessages(
  rawMessages: Props["initialMessages"],
  pending: PendingConfirmation | null
): Message[] {
  const msgs: Message[] = rawMessages.map((m) => {
    const sp = m.structured_payload as Record<string, unknown> | undefined;
    if (sp?.type === "pending_confirmation") {
      return {
        role: m.role,
        content: m.content,
        created_at: m.created_at,
        confirmation: {
          kind: "human_approval",
          tool_call_id: sp.tool_call_id as string,
          tool_name: sp.tool_name as string,
          message: sp.message as string,
          args: (sp.args as Record<string, unknown>) ?? {},
        },
        // Will be set to "pending" below if it matches the still-unresolved call
        confirmationStatus: "approved",
      };
    }
    return { role: m.role, content: m.content, created_at: m.created_at };
  });

  // Mark the message that corresponds to the active pending confirmation as "pending"
  if (pending) {
    const idx = msgs.findIndex(
      (m) => m.confirmation?.tool_call_id === pending.tool_call_id
    );
    if (idx !== -1) {
      msgs[idx] = { ...msgs[idx], confirmationStatus: "pending" };
    } else {
      // No matching message found — append a synthetic one
      msgs.push({
        role: "assistant",
        content: pending.message,
        confirmation: { ...pending, kind: "human_approval" },
        confirmationStatus: "pending",
      });
    }
  }

  return msgs;
}

export function ChatInterface({
  agentName,
  initialMessages,
  sessions,
  currentSessionId,
  initialPendingConfirmation,
  enabledTools,
}: Props) {
  const [messages, setMessages] = useState<Message[]>(() =>
    buildInitialMessages(initialMessages, initialPendingConfirmation)
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(currentSessionId);
  const [sessionList, setSessionList] = useState<SessionItem[]>(sessions);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSwitchSession(sessionId: string) {
    if (sessionId === activeSessionId) return;

    const { data: rawMsgs } = await supabase
      .from("agent_messages")
      .select("role, content, created_at, structured_payload")
      .eq("session_id", sessionId)
      .not("content", "is", null)
      .neq("content", "")
      .order("created_at", { ascending: true })
      .limit(50);

    const { data: pendingCalls } = await supabase
      .from("tool_calls")
      .select("id, tool_name, arguments_json")
      .eq("session_id", sessionId)
      .eq("status", "pending_confirmation")
      .order("created_at", { ascending: false })
      .limit(1);

    const pending: PendingConfirmation | null =
      pendingCalls && pendingCalls.length > 0
        ? {
            kind: "human_approval",
            tool_call_id: pendingCalls[0].id,
            tool_name: pendingCalls[0].tool_name,
            message: `Se requiere confirmación para "${pendingCalls[0].tool_name}".`,
            args: (pendingCalls[0].arguments_json as Record<string, unknown>) ?? {},
          }
        : null;

    setMessages(buildInitialMessages(rawMsgs ?? [], pending));
    setActiveSessionId(sessionId);
  }

  async function handleNewSession() {
    const res = await fetch("/api/sessions", { method: "POST" });
    const { session } = await res.json();
    if (session) {
      setSessionList((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
    }
  }

  async function handleClearSession() {
    if (!activeSessionId) return;
    await fetch(`/api/sessions/${activeSessionId}/clear`, { method: "POST" });
    setMessages([]);
  }

  async function handleConfirm(index: number, action: "approve" | "reject") {
    const msg = messages[index];
    if (!msg.confirmation) return;

    setMessages((prev) =>
      prev.map((m, i) =>
        i === index
          ? { ...m, confirmationStatus: action === "approve" ? "approved" : "rejected" }
          : m
      )
    );

    setLoading(true);
    try {
      const res = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolCallId: msg.confirmation.tool_call_id,
          action,
        }),
      });
      const data = await res.json();

      if (data.response) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.response },
        ]);
      }

      // Another tool in the resumed graph may require confirmation too
      if (data.responseType === "pending_confirmation" && data.pendingConfirmation) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.pendingConfirmation.message,
            confirmation: data.pendingConfirmation,
            confirmationStatus: "pending",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error al procesar la confirmacion." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: activeSessionId }),
      });
      if (!res.ok) throw new Error(`Error del servidor: ${res.status}`);

      const data = await res.json();

      if (data.response) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.response },
        ]);
      }

      if (data.responseType === "pending_confirmation" && data.pendingConfirmation) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.pendingConfirmation.message,
            confirmation: data.pendingConfirmation,
            confirmationStatus: "pending",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error al procesar tu mensaje. Intenta de nuevo." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const isReadOnly = !activeSessionId;
  const hasPendingConfirmation = messages.some((m) => m.confirmationStatus === "pending");

  async function handleChipClick(chipMessage: string) {
    if (loading || !activeSessionId || hasPendingConfirmation) return;
    setMessages((prev) => [...prev, { role: "user", content: chipMessage }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chipMessage, sessionId: activeSessionId }),
      });
      if (!res.ok) throw new Error(`Error del servidor: ${res.status}`);
      const data = await res.json();
      if (data.response) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
      }
      if (data.responseType === "pending_confirmation" && data.pendingConfirmation) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.pendingConfirmation.message,
            confirmation: data.pendingConfirmation,
            confirmationStatus: "pending",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error al procesar tu mensaje. Intenta de nuevo." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-0"
        } flex-shrink-0 overflow-hidden border-r border-neutral-200 transition-all dark:border-neutral-800`}
      >
        <div className="flex h-full w-64 flex-col">
          <div className="p-3">
            <button
              onClick={handleNewSession}
              className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Nueva sesion
            </button>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {sessionList.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSwitchSession(s.id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  s.id === activeSessionId
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-900"
                }`}
              >
                <div className="truncate font-medium text-xs">
                  {formatSessionDate(s.created_at)}
                </div>
              </button>
            ))}
            {sessionList.length === 0 && (
              <p className="px-3 py-4 text-xs text-neutral-400">
                No hay sesiones. Crea una nueva.
              </p>
            )}
          </nav>
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="Sesiones"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="flex-1 truncate text-xs text-neutral-500">
            {activeSessionId ? "Sesion activa" : "Sin sesion"}
          </span>
          {activeSessionId && (
            <button
              onClick={handleClearSession}
              className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-lg font-medium text-neutral-600 dark:text-neutral-300">
                  Hola, soy tu agente.
                </p>
                <p className="mt-1 text-sm text-neutral-400">
                  Prueba alguna de estas acciones o escribe lo que necesitas.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {getChips(enabledTools).map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => handleChipClick(chip.message)}
                      disabled={loading || !activeSessionId || hasPendingConfirmation}
                      className="rounded-full border border-blue-300 bg-blue-50 px-4 py-1.5 text-sm text-blue-700 transition hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] overflow-hidden break-words rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <RenderMd content={msg.content} />
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  )}
                  {msg.confirmation && msg.confirmationStatus === "pending" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleConfirm(i, "approve")}
                        disabled={loading}
                        className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Aprobar
                      </button>
                      <button
                        onClick={() => handleConfirm(i, "reject")}
                        disabled={loading}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                  {msg.confirmation && msg.confirmationStatus === "approved" && (
                    <p className="mt-2 text-xs font-medium text-green-700 dark:text-green-400">Aprobado</p>
                  )}
                  {msg.confirmation && msg.confirmationStatus === "rejected" && (
                    <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">Cancelado</p>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-neutral-100 px-4 py-2.5 text-sm dark:bg-neutral-800">
                  <span className="animate-pulse">Pensando...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input — disabled while a confirmation is pending */}
        <div className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          {hasPendingConfirmation && (
            <p className="mx-auto mb-2 max-w-2xl text-center text-xs text-amber-600 dark:text-amber-400">
              Aprueba o cancela la acción pendiente antes de continuar.
            </p>
          )}
          <form
            onSubmit={handleSend}
            className="mx-auto flex max-w-2xl gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu mensaje..."
              disabled={loading || isReadOnly || hasPendingConfirmation}
              className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="submit"
              disabled={loading || !input.trim() || isReadOnly || hasPendingConfirmation}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Enviar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
