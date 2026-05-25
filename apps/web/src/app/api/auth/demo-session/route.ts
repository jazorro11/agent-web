import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * GET /api/auth/demo-session
 *
 * Signs in as the shared demo account and redirects to /chat.
 * Credentials are server-side env vars only — never exposed to the client.
 * The demo account has is_demo_user=true in profiles, which restricts it
 * to low-risk (read-only) tools in the chat API.
 */
export async function GET(request: Request) {
  const email = process.env.DEMO_USER_EMAIL;
  const password = process.env.DEMO_USER_PASSWORD;

  if (!email || !password) {
    // Demo not configured — redirect to login with a query param so the UI can show a message
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
                cookieStore.set(name, value, options)
              );
            } catch {
              // Ignore — cookies() in Route Handlers is writable, but guard just in case
            }
          },
        },
      }
    );

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.error("[demo-session] Sign-in failed:", error.message);
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "demo_failed");
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.redirect(new URL("/chat", request.url));
  } catch (err) {
    console.error("[demo-session] Unexpected error:", err);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "demo_failed");
    return NextResponse.redirect(loginUrl);
  }
}
