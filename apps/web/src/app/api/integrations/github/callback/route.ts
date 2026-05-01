import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGithubOAuthRedirectUri } from "@/lib/github-oauth";
import { createServerClient, upsertIntegration } from "@agents/db";
import { encrypt } from "@agents/db";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      `${origin}/settings?github=error&reason=${errorParam}`
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("github_oauth_state="))
    ?.split("=")[1];

  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(
      `${origin}/settings?github=error&reason=state_mismatch`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/settings?github=error&reason=no_code`
    );
  }

  const redirectUri = getGithubOAuthRedirectUri(request);

  const tokenRes = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    }
  );

  const tokenData = await tokenRes.json();

  if (tokenData.error || !tokenData.access_token) {
    console.error("GitHub token exchange failed:", tokenData);
    return NextResponse.redirect(
      `${origin}/settings?github=error&reason=token_exchange`
    );
  }

  const encryptedToken = encrypt(tokenData.access_token);
  const scopes = tokenData.scope
    ? (tokenData.scope as string).split(",")
    : ["repo"];

  const db = createServerClient();
  await upsertIntegration(db, user.id, "github", scopes, encryptedToken);

  const response = NextResponse.redirect(`${origin}/settings?github=connected`);
  response.cookies.delete("github_oauth_state");
  return response;
}
