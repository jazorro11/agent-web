import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, decrypt, touchSession } from "@agents/db";
import { runAgent, flushSessionMemory } from "@agents/agent";

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

    const db = createServerClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("agent_system_prompt, agent_name")
      .eq("id", user.id)
      .single();

    const { data: toolSettings } = await supabase
      .from("user_tool_settings")
      .select("*")
      .eq("user_id", user.id);

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
    });

    // Fire-and-forget: extract long-term memories after a normal completion.
    // Only skipped when the graph is paused waiting for HITL confirmation.
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
