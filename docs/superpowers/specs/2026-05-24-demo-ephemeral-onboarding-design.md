# Demo ephemeral + onboarding flow

**Date:** 2026-05-24  
**Status:** Approved

## Problem

The demo session had two issues:
1. The "Regístrate para acceso completo" CTA went nowhere (middleware blocked authenticated users from `/signup`).
2. The demo session used a shared Supabase account with a persistent session cookie and accumulated chat history across visitors — no true ephemerality.

## Goals

- Demo visitors always start with the onboarding wizard (pre-filled with demo defaults, adjustable).
- Demo session cookie expires in 20 minutes (absolute) and does not persist across browser restarts beyond that TTL.
- Each demo visit starts with a clean chat history.
- The "Regístrate para acceso completo" CTA correctly signs out the demo session and takes the user through real signup → onboarding → chat.

## Out of scope

- Multiple concurrent demo users (accepted risk: shared account, last writer wins on profile state).
- Sliding-window idle timeout (absolute 20-min TTL is sufficient).
- Replacing the shared demo account with anonymous Supabase auth.

## Flow

```
/login → "Ver demo en vivo →" → GET /api/auth/demo-session

DEMO-SESSION ROUTE:
  1. signInWithPassword(DEMO_USER_EMAIL, DEMO_USER_PASSWORD)
  2. UPDATE profiles SET onboarding_completed = false WHERE id = demo_user.id
     (profile keeps pre-configured name, agent_name, agent_system_prompt, tool defaults)
  3. DELETE FROM agent_messages WHERE user_id = demo_user.id
  4. DELETE FROM agent_sessions WHERE user_id = demo_user.id
  5. Override Supabase cookie options: maxAge = 1200, expires = undefined
  6. redirect → /onboarding

/onboarding (wizard):
  · Loads initialProfile with demo pre-filled values
  · User confirms or adjusts: Perfil → Agente → Herramientas → Revisión
  · handleFinish() upserts profile (onboarding_completed = true) → redirect /chat

/chat (demo user):
  · Banner: "Estás probando el demo — Regístrate para acceso completo →"
  · href → /api/auth/demo-exit

/api/auth/demo-exit:
  · signOut()
  · redirect /signup

/signup → /onboarding (blank, real user) → /chat (no banner)

[After 20 min]: cookie expires → middleware → redirect /login
```

## Changes

### `apps/web/src/app/api/auth/demo-session/route.ts` — only file with new logic

After `signInWithPassword` succeeds:

1. **Reset onboarding state** — `UPDATE profiles SET onboarding_completed = false WHERE id = user.id`  
   Uses the authenticated SSR client (RLS allows user to update their own profile).

2. **Clear history** — delete messages first (FK dependency), then sessions:
   ```
   DELETE FROM agent_messages WHERE user_id = user.id
   DELETE FROM agent_sessions  WHERE user_id = user.id
   ```
   Uses the authenticated SSR client — demo user owns these rows via RLS (`user_id = auth.uid()`).

3. **Cookie override** — In the `setAll` callback, wrap each cookie option:
   ```typescript
   cookieStore.set(name, value, {
     ...options,
     maxAge: 1200,
     expires: undefined,
   })
   ```

4. **Redirect** — `NextResponse.redirect(new URL("/onboarding", request.url))`

### No changes needed

| File | Reason |
|---|---|
| `api/auth/demo-exit/route.ts` | Already correct (signOut → /signup) |
| `lib/supabase/middleware.ts` | Already has demo-exit in publicPaths |
| `app/onboarding/page.tsx` | Already handles onboarding_completed = false correctly |
| `app/chat/page.tsx` | Banner + CTA already exist |

## Security constraints

- Service role key only used for the bulk delete inside `demo-session` route — a server-only, non-user-facing endpoint.
- All other demo interactions use the authenticated SSR client (RLS enforced).
- Demo user's `is_demo_user = true` in profiles restricts tools to read-only at the agent level — unchanged.

## Acceptance criteria

- [ ] Clicking "Ver demo en vivo" lands on `/onboarding` with pre-filled demo values.
- [ ] Completing onboarding lands on `/chat` with demo banner.
- [ ] Cookie expires after 20 min (verifiable via DevTools → Application → Cookies).
- [ ] After signing out + refreshing, no active Supabase session remains.
- [ ] Clicking "Regístrate para acceso completo" signs out the demo and lands on `/signup`.
- [ ] Completing signup + onboarding as a new user lands on `/chat` without demo banner.
- [ ] New demo visit starts with empty chat (no messages from prior visits).
