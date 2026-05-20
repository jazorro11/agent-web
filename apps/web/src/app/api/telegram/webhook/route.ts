import { NextResponse } from "next/server";
import {
  createServerClient,
  decrypt,
  getPendingToolCall,
} from "@agents/db";
import { runAgent, resolveGoogleToken, resolveNotionToken } from "@agents/agent";
import { sendTelegramMessage } from "@/lib/telegram/send";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string };
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message: { chat: { id: number }; message_id: number };
    data: string;
  };
}

function parseBotCommand(messageText: string): { command: string; args: string } {
  const trimmed = messageText.trim();
  const i = trimmed.indexOf(" ");
  const head = i === -1 ? trimmed : trimmed.slice(0, i);
  const tail = i === -1 ? "" : trimmed.slice(i + 1).trim();
  const at = head.indexOf("@");
  const command = (at === -1 ? head : head.slice(0, at)).toLowerCase();
  return { command, args: tail };
}

async function answerCallbackQuery(callbackQueryId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

async function resolveGitHubToken(
  db: ReturnType<typeof createServerClient>,
  userId: string
): Promise<string | undefined> {
  const { data: integration } = await db
    .from("user_integrations")
    .select("encrypted_tokens")
    .eq("user_id", userId)
    .eq("provider", "github")
    .eq("status", "active")
    .single();

  if (!integration?.encrypted_tokens) return undefined;
  try {
    return decrypt(integration.encrypted_tokens);
  } catch (err) {
    console.error("Failed to decrypt GitHub token:", err);
    return undefined;
  }
}

async function buildAgentContext(
  db: ReturnType<typeof createServerClient>,
  userId: string,
  sessionId: string
) {
  const { data: profile } = await db
    .from("profiles")
    .select("agent_system_prompt")
    .eq("id", userId)
    .single();

  const { data: toolSettings } = await db
    .from("user_tool_settings")
    .select("*")
    .eq("user_id", userId);

  const { data: integrations } = await db
    .from("user_integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active");

  const githubToken = await resolveGitHubToken(db, userId);

  let googleToken: string | undefined;
  const hasGoogle = (integrations ?? []).some(
    (i: Record<string, unknown>) => i.provider === "google"
  );
  if (hasGoogle) {
    try {
      const t = await resolveGoogleToken(db, userId);
      if (t) googleToken = t;
    } catch (err) {
      console.error("Failed to resolve Google token:", err);
    }
  }

  let notionToken: string | undefined;
  const hasNotion = (integrations ?? []).some(
    (i: Record<string, unknown>) => i.provider === "notion"
  );
  if (hasNotion) {
    try {
      const t = await resolveNotionToken(db, userId);
      if (t) notionToken = t;
    } catch (err) {
      console.error("Failed to resolve Notion token:", err);
    }
  }

  return {
    userId,
    sessionId,
    systemPrompt: (profile?.agent_system_prompt as string) ?? "Eres un asistente útil.",
    db,
    enabledTools: (toolSettings ?? []).map((t: Record<string, unknown>) => ({
      id: t.id as string,
      user_id: t.user_id as string,
      tool_id: t.tool_id as string,
      enabled: t.enabled as boolean,
      config_json: (t.config_json as Record<string, unknown>) ?? {},
    })),
    integrations: (integrations ?? []).map((i: Record<string, unknown>) => ({
      id: i.id as string,
      user_id: i.user_id as string,
      provider: i.provider as string,
      scopes: (i.scopes as string[]) ?? [],
      status: i.status as "active" | "revoked" | "expired",
      created_at: i.created_at as string,
    })),
    githubToken,
    googleToken,
    notionToken,
  };
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update: TelegramUpdate = await request.json();
  const db = createServerClient();

  // ── Callback query: approve / reject a pending tool call ──────────────────
  if (update.callback_query) {
    const cb = update.callback_query;
    const [action, toolCallId] = cb.data.split(":");

    if ((action === "approve" || action === "reject") && toolCallId) {
      const toolCall = await getPendingToolCall(db, toolCallId);
      if (!toolCall) {
        await answerCallbackQuery(cb.id, "Ya fue procesado");
        return NextResponse.json({ ok: true });
      }

      await answerCallbackQuery(cb.id, action === "approve" ? "Aprobado ✓" : "Cancelado ✗");
      await sendTelegramMessage(
        cb.message.chat.id,
        action === "approve" ? "Acción aprobada. Procesando..." : "Acción cancelada."
      );

      // Look up session → user
      const { data: session } = await db
        .from("agent_sessions")
        .select("user_id")
        .eq("id", toolCall.session_id)
        .single();

      if (!session) {
        await sendTelegramMessage(cb.message.chat.id, "Error: sesión no encontrada.");
        return NextResponse.json({ ok: true });
      }

      try {
        const ctx = await buildAgentContext(db, session.user_id, toolCall.session_id);
        const result = await runAgent({
          ...ctx,
          resumeDecision: action as "approve" | "reject",
        });

        if (result.responseType === "pending_confirmation" && result.pendingConfirmation) {
          await sendTelegramMessage(cb.message.chat.id, result.pendingConfirmation.message, {
            inline_keyboard: [
              [
                {
                  text: "Aprobar",
                  callback_data: `approve:${result.pendingConfirmation.tool_call_id}`,
                },
                {
                  text: "Cancelar",
                  callback_data: `reject:${result.pendingConfirmation.tool_call_id}`,
                },
              ],
            ],
          });
        } else if (result.response) {
          await sendTelegramMessage(cb.message.chat.id, result.response);
        }
      } catch (err) {
        console.error("Telegram resume error:", err);
        await sendTelegramMessage(cb.message.chat.id, "Hubo un error al procesar la acción.");
      }
    }

    return NextResponse.json({ ok: true });
  }

  // ── Regular message ────────────────────────────────────────────────────────
  const message = update.message;
  if (!message?.text) {
    return NextResponse.json({ ok: true });
  }

  const telegramUserId = message.from.id;
  const chatId = message.chat.id;
  const text = message.text.trim();
  const { command, args } = parseBotCommand(text);

  if (command === "/start") {
    await sendTelegramMessage(
      chatId,
      "¡Hola! Soy tu agente personal.\n\nComandos disponibles:\n/link <codigo> - Vincular tu cuenta web\n/sessions - Ver tus sesiones\n/new - Crear nueva sesion\n/switch <numero> - Cambiar de sesion\n/clear - Limpiar la sesion actual"
    );
    return NextResponse.json({ ok: true });
  }

  if (command === "/link") {
    const code = args.trim().toUpperCase();
    if (!code) {
      await sendTelegramMessage(
        chatId,
        "Indica el código que generaste en la web, por ejemplo:\n/link ABC123"
      );
      return NextResponse.json({ ok: true });
    }

    const { data: linkRecord } = await db
      .from("telegram_link_codes")
      .select("*")
      .eq("code", code)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (!linkRecord) {
      await sendTelegramMessage(chatId, "Código inválido o expirado. Genera uno nuevo desde la web.");
      return NextResponse.json({ ok: true });
    }

    await db.from("telegram_accounts").upsert(
      {
        user_id: linkRecord.user_id,
        telegram_user_id: telegramUserId,
        chat_id: chatId,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    await db
      .from("telegram_link_codes")
      .update({ used: true })
      .eq("id", linkRecord.id);

    await sendTelegramMessage(chatId, "¡Cuenta vinculada correctamente! Ya puedes chatear conmigo.");
    return NextResponse.json({ ok: true });
  }

  const { data: telegramAccount } = await db
    .from("telegram_accounts")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .single();

  if (!telegramAccount) {
    await sendTelegramMessage(
      chatId,
      "No tienes una cuenta vinculada. Usa /link TU_CODIGO (código desde Ajustes en la web)."
    );
    return NextResponse.json({ ok: true });
  }

  const userId = telegramAccount.user_id;

  // ── Session management commands ───────────────────────────────────────────

  if (command === "/sessions") {
    const { data: userSessions } = await db
      .from("agent_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("channel", "telegram")
      .eq("status", "active")
      .order("last_used_at", { ascending: false });

    if (!userSessions || userSessions.length === 0) {
      await sendTelegramMessage(chatId, "No tienes sesiones. Usa /new para crear una.");
      return NextResponse.json({ ok: true });
    }

    const lines = userSessions.map((s: Record<string, unknown>, i: number) => {
      const date = new Date(s.created_at as string).toLocaleDateString("es");
      const marker = i === 0 ? " (actual)" : "";
      return `${i + 1}. ${date}${marker}`;
    });

    await sendTelegramMessage(
      chatId,
      `Tus sesiones:\n${lines.join("\n")}\n\nUsa /switch <numero> para cambiar.`
    );
    return NextResponse.json({ ok: true });
  }

  if (command === "/new") {
    const { data: newSession } = await db
      .from("agent_sessions")
      .insert({
        user_id: userId,
        channel: "telegram",
        status: "active",
        budget_tokens_used: 0,
        budget_tokens_limit: 100000,
        last_used_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (!newSession) {
      await sendTelegramMessage(chatId, "Error creando sesion.");
      return NextResponse.json({ ok: true });
    }

    await sendTelegramMessage(chatId, "Nueva sesion creada. Ya puedes chatear.");
    return NextResponse.json({ ok: true });
  }

  if (command === "/switch") {
    const num = parseInt(args, 10);
    if (isNaN(num) || num < 1) {
      await sendTelegramMessage(chatId, "Indica un numero valido. Ejemplo: /switch 2");
      return NextResponse.json({ ok: true });
    }

    const { data: userSessions } = await db
      .from("agent_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("channel", "telegram")
      .eq("status", "active")
      .order("last_used_at", { ascending: false });

    if (!userSessions || num > userSessions.length) {
      await sendTelegramMessage(chatId, `No existe la sesion ${num}. Usa /sessions para ver la lista.`);
      return NextResponse.json({ ok: true });
    }

    const target = userSessions[num - 1];
    await db
      .from("agent_sessions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", target.id);

    await sendTelegramMessage(chatId, `Cambiado a sesion ${num}.`);
    return NextResponse.json({ ok: true });
  }

  if (command === "/clear") {
    const { data: currentSession } = await db
      .from("agent_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("channel", "telegram")
      .eq("status", "active")
      .order("last_used_at", { ascending: false })
      .limit(1)
      .single();

    if (!currentSession) {
      await sendTelegramMessage(chatId, "No tienes una sesion activa. Usa /new para crear una.");
      return NextResponse.json({ ok: true });
    }

    await db.from("agent_messages").delete().eq("session_id", currentSession.id);
    await db.from("tool_calls").delete().eq("session_id", currentSession.id);

    await sendTelegramMessage(chatId, "Sesion limpiada. El agente no recuerda mensajes anteriores.");
    return NextResponse.json({ ok: true });
  }

  // ── Regular agent turn ────────────────────────────────────────────────────

  let session = await db
    .from("agent_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("channel", "telegram")
    .eq("status", "active")
    .order("last_used_at", { ascending: false })
    .limit(1)
    .single()
    .then((r) => r.data);

  if (!session) {
    const { data } = await db
      .from("agent_sessions")
      .insert({
        user_id: userId,
        channel: "telegram",
        status: "active",
        budget_tokens_used: 0,
        budget_tokens_limit: 100000,
        last_used_at: new Date().toISOString(),
      })
      .select()
      .single();
    session = data;
  }

  if (!session) {
    await sendTelegramMessage(chatId, "Error interno creando sesion.");
    return NextResponse.json({ ok: true });
  }

  await db
    .from("agent_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", session.id);

  try {
    console.log("[webhook] Starting runAgent with message:", text.substring(0, 100));
    const ctx = await buildAgentContext(db, userId, session.id);
    console.log("[webhook] buildAgentContext complete, enabledTools:", ctx.enabledTools.map(t => t.tool_id));
    const result = await runAgent({ ...ctx, message: text });
    console.log("[webhook] runAgent completed successfully, responseType:", result.responseType);

    if (result.responseType === "pending_confirmation" && result.pendingConfirmation) {
      // Send the agent's conversational reply first if different from the confirmation prompt
      if (result.response && result.response !== result.pendingConfirmation.message) {
        await sendTelegramMessage(chatId, result.response);
      }
      await sendTelegramMessage(chatId, result.pendingConfirmation.message, {
        inline_keyboard: [
          [
            {
              text: "✅ Aprobar",
              callback_data: `approve:${result.pendingConfirmation.tool_call_id}`,
            },
            {
              text: "❌ Cancelar",
              callback_data: `reject:${result.pendingConfirmation.tool_call_id}`,
            },
          ],
        ],
      });
    } else {
      await sendTelegramMessage(chatId, result.response);
    }
  } catch (error) {
    console.error("[webhook] Telegram agent error - type:", error instanceof Error ? error.constructor.name : typeof error);
    console.error("[webhook] Telegram agent error details:", error);
    if (error instanceof Error) {
      console.error("[webhook] Error stack:", error.stack);
    }
    await sendTelegramMessage(chatId, "Hubo un error procesando tu mensaje. Intenta de nuevo.");
  }

  return NextResponse.json({ ok: true });
}
