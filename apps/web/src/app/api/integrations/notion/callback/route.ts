import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerClient, upsertIntegration, encrypt } from "@agents/db";

const NOTION_VERSION = "2022-06-28";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      `${origin}/settings?notion=error&reason=${encodeURIComponent(errorParam)}`
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const cookieState = request.cookies.get("notion_oauth_state")?.value;

  if (!state || !cookieState || state !== cookieState) {
    const res = NextResponse.redirect(
      `${origin}/settings?notion=error&reason=state_mismatch`
    );
    res.cookies.delete("notion_oauth_state");
    return res;
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/settings?notion=error&reason=no_code`
    );
  }

  const clientId = process.env.NOTION_CLIENT_ID ?? "";
  const clientSecret = process.env.NOTION_CLIENT_SECRET ?? "";
  const redirectUri = `${origin}/api/integrations/notion/callback`;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });

  const tokenData = (await tokenRes.json()) as Record<string, unknown>;

  if (!tokenRes.ok || !tokenData.access_token) {
    console.error("Notion token exchange failed:", tokenData?.error ?? "unknown error");
    return NextResponse.redirect(
      `${origin}/settings?notion=error&reason=token_exchange`
    );
  }

  const encryptedTokens = encrypt(
    JSON.stringify({ access_token: String(tokenData.access_token) })
  );

  const db = createServerClient();
  await upsertIntegration(db, user.id, "notion", [], encryptedTokens, null);

  const response = NextResponse.redirect(`${origin}/settings?notion=connected`);
  response.cookies.delete("notion_oauth_state");
  return response;
}
