import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGoogleOAuthRedirectUri } from "@/lib/google-oauth";
import {
  createServerClient,
  upsertIntegration,
  encrypt,
  decrypt,
  getActiveIntegrationCredentials,
} from "@agents/db";

const DEFAULT_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      `${origin}/settings?google=error&reason=${encodeURIComponent(errorParam)}`
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const cookieState = request.cookies.get("google_oauth_state")?.value;

  if (!state || !cookieState || state !== cookieState) {
    const res = NextResponse.redirect(
      `${origin}/settings?google=error&reason=state_mismatch`
    );
    // Clear stale state so the next OAuth attempt starts cleanly.
    res.cookies.delete("google_oauth_state");
    return res;
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/settings?google=error&reason=no_code`
    );
  }

  const redirectUri = getGoogleOAuthRedirectUri(request);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const tokenData = (await tokenRes.json()) as Record<string, unknown>;

  if (!tokenRes.ok || tokenData.error || !tokenData.access_token) {
    console.error("Google token exchange failed:", tokenData?.error ?? "unknown error");
    return NextResponse.redirect(
      `${origin}/settings?google=error&reason=token_exchange`
    );
  }

  const accessToken = String(tokenData.access_token);
  let refreshToken =
    typeof tokenData.refresh_token === "string"
      ? tokenData.refresh_token
      : undefined;

  const db = createServerClient();
  if (!refreshToken) {
    const existing = await getActiveIntegrationCredentials(db, user.id, "google");
    if (existing) {
      try {
        const prev = JSON.parse(decrypt(existing.encrypted_tokens)) as {
          refresh_token?: string;
        };
        if (prev.refresh_token) refreshToken = prev.refresh_token;
      } catch {
        /* ignore */
      }
    }
  }

  const expiresIn =
    typeof tokenData.expires_in === "number"
      ? tokenData.expires_in
      : Number(tokenData.expires_in) || 3600;

  const encryptedToken = encrypt(
    JSON.stringify({
      access_token: accessToken,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    })
  );

  const scopes = tokenData.scope
    ? String(tokenData.scope)
        .split(/\s+/)
        .filter(Boolean)
    : DEFAULT_GOOGLE_SCOPES;

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  await upsertIntegration(db, user.id, "google", scopes, encryptedToken, expiresAt);

  const response = NextResponse.redirect(`${origin}/settings?google=connected`);
  response.cookies.delete("google_oauth_state");
  return response;
}
