import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, getPendingToolCall, decrypt } from "@agents/db";
import { runAgent, resolveGoogleToken, resolveNotionToken } from "@agents/agent";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { toolCallId, action } = await request.json();
    if (!toolCallId || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const db = createServerClient();
    const toolCall = await getPendingToolCall(db, toolCallId);

    if (!toolCall) {
      return NextResponse.json(
        { error: "Tool call not found or already resolved" },
        { status: 404 }
      );
    }

    const { data: sessionRow } = await supabase
      .from("agent_sessions")
      .select("*")
      .eq("id", toolCall.session_id)
      .eq("user_id", user.id)
      .single();

    if (!sessionRow) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Load user context needed to reconstruct the agent
    const { data: profile } = await supabase
      .from("profiles")
      .select("agent_system_prompt")
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
      } catch {
        // ignore decrypt errors
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
      } catch {
        // ignore
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
      } catch {
        // ignore
      }
    }

    // Resume the interrupted LangGraph with the human decision
    const result = await runAgent({
      resumeDecision: action as "approve" | "reject",
      userId: user.id,
      sessionId: toolCall.session_id,
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
    });

    return NextResponse.json({
      ok: true,
      responseType: result.responseType,
      response: result.response,
      pendingConfirmation: result.pendingConfirmation ?? null,
    });
  } catch (error) {
    console.error("Confirm API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
