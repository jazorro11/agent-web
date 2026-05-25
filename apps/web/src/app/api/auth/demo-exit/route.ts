import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/auth/demo-exit
 *
 * Signs out the demo session and redirects to /signup so the user
 * can create a real account. Needed because the middleware blocks
 * authenticated users from reaching /signup directly.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/signup`, { status: 302 });
}
