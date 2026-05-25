import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const DEMO_SESSION_TTL = 20 * 60; // 20 min in seconds

/**
 * GET /api/auth/demo-session
 *
 * Signs in as the shared demo account with an ephemeral session:
 * - Cookie maxAge = 20 min (no persistent token survives after that)
 * - Resets onboarding_completed so the visitor always goes through the wizard
 * - Clears previous chat history (messages + sessions)
 * - Redirects to /onboarding so each demo visit starts fresh
 *
 * The demo account has is_demo_user=true in profiles, which restricts it
 * to low-risk (read-only) tools in both the chat API and the onboarding wizard.
 */
export async function GET(request: Request) {
  const email = process.env.DEMO_USER_EMAIL;
  const password = process.env.DEMO_USER_PASSWORD;

  if (!email || !password) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "demo_unavailable");
    return NextResponse.redirect(loginUrl);
  }

  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                // Override Supabase's default long-lived token expiry with a 20-min TTL.
                // This makes the demo session ephemeral: it dies when the browser closes
                // (no localStorage persistence) or after 20 min, whichever comes first.
                cookieStore.set(name, value, {
                  ...options,
                  maxAge: DEMO_SESSION_TTL,
                  expires: undefined,
                })
              );
            } catch {
              // cookies() in Route Handlers is writable, but guard just in case
            }
          },
        },
      }
    );

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData.user) {
      console.error("[demo-session] Sign-in failed:", signInError?.message);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "demo_failed");
      return NextResponse.redirect(loginUrl);
    }

    const userId = signInData.user.id;

    // Clear previous demo history so each visit starts with an empty chat.
    // Delete messages before sessions to respect the FK constraint.
    await supabase.from("agent_messages").delete().eq("user_id", userId);
    await supabase.from("agent_sessions").delete().eq("user_id", userId);

    // Reset onboarding so the visitor always goes through the wizard with demo defaults.
    await supabase
      .from("profiles")
      .update({ onboarding_completed: false, updated_at: new Date().toISOString() })
      .eq("id", userId);

    return NextResponse.redirect(new URL("/onboarding", request.url));
  } catch (err) {
    console.error("[demo-session] Unexpected error:", err);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "demo_failed");
    return NextResponse.redirect(loginUrl);
  }
}
