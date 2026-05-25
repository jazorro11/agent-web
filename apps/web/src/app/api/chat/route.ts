import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, decrypt, touchSession } from "@agents/db";
import { runAgent, flushSessionMemory, resolveGoogleToken, resolveNotionToken } from "@agents/agent";
import { getToolRisk } from "@agents/types";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { message, sessionId: requestedSessionId } = await request.json();
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }
    if (message.length > 10_000) {
      return NextResponse.json({ error: "Message too long (max 10,000 characters)" }, { status: 400 });
    }

    const { data: allowed } = await supabase.rpc("check_and_increment_rate_limit", {
      p_user_id: user.id,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: "Has alcanzado el límite diario de 10 mensajes. Vuelve mañana." },
        { status: 429 }
      );
    }

    const db = createServerClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("agent_system_prompt, agent_name, is_demo_user")
      .eq("id", user.id)
      .single();

    const isDemoUser = (profile?.is_demo_user as boolean) ?? false;

    const { data: toolSettings } = await supabase
      .from("user_tool_settings")
      .select("*")
      .eq("user_id", user.id);

    // Demo accounts are restricted to low-risk (read-only) tools only.
    const effectiveToolSettings = isDemoUser
      ? (toolSettings ?? []).filter(
          (t: Record<string, unknown>) => getToolRisk(t.tool_id as string) === "low"
        )
      : (toolSettings ?? []);

    if (process.env.AGENT_DEBUG_LOGS === "true") {
      console.log("[chat] isDemoUser:", isDemoUser);
      console.log("[chat] enabledTools from DB:", JSON.stringify(
        effectiveToolSettings.map((t: Record<string, unknown>) => ({
          tool_id: t.tool_id,
          enabled: t.enabled,
        }))
      ));
    }

    const { data: integrations } = await supabase
      .from("user_integrations")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active");

    let githubToken: string | undefined;
    const githubIntegration = (integrations ?? []).find(
      (i: Record<string, unknown>) => i.provider === "github"
    );
    if (githubIntegration?.encrypted_tokens) {
      try {
        githubToken = decrypt(githubIntegration.encrypted_tokens as string);
      } catch (err) {
        console.error("Failed to decrypt GitHub token:", err);
      }
    }

    let googleToken: string | undefined;
    const hasGoogle = (integrations ?? []).some(
      (i: Record<string, unknown>) => i.provider === "google"
    );
    if (hasGoogle) {
      try {
        const t = await resolveGoogleToken(db, user.id);
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
        const t = await resolveNotionToken(db, user.id);
        if (t) notionToken = t;
      } catch (err) {
        console.error("Failed to resolve Notion token:", err);
      }
    }

    let session;
    if (requestedSessionId) {
      session = await supabase
        .from("agent_sessions")
        .select("*")
        .eq("id", requestedSessionId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single()
        .then((r) => r.data);
      if (!session) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
    } else {
      session = await supabase
        .from("agent_sessions")
        .select("*")
        .eq("user_id", user.id)
        .eq("channel", "web")
        .eq("status", "active")
        .order("last_used_at", { ascending: false })
        .limit(1)
        .single()
        .then((r) => r.data);

      if (!session) {
        const { data } = await supabase
          .from("agent_sessions")
          .insert({
            user_id: user.id,
            channel: "web",
            status: "active",
            budget_tokens_used: 0,
            budget_tokens_limit: 100000,
          })
          .select()
          .single();
        session = data;
      }
    }

    if (!session) {
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    await touchSession(db, session.id);

    const result = await runAgent({
      message,
      userId: user.id,
      sessionId: session.id,
      systemPrompt: (profile?.agent_system_prompt as string) ?? "Eres un asistente útil.",
      db,
      enabledTools: effectiveToolSettings.map((t: Record<string, unknown>) => ({
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
      isDemoUser,
    });

    if (!result.pendingConfirmation) {
      flushSessionMemory({ db, userId: user.id, sessionId: session.id }).catch(
        (err) => console.error("[chat] memory flush failed:", err)
      );
    }

    return NextResponse.json({
      responseType: result.responseType,
      response: result.pendingConfirmation ? null : result.response,
      pendingConfirmation: result.pendingConfirmation ?? null,
      toolCalls: result.toolCalls,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
