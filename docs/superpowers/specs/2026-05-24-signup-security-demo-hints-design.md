# Design: Signup/Login — Security Footnote & Demo Hint

**Date:** 2026-05-24  
**Status:** Approved

## Context

The app is publicly deployed on Vercel. Two small UX improvements were requested for the auth pages:

1. Reassure users that their credentials are genuinely protected (backed by verified security measures).
2. Suggest that demo visitors use an alternate email and simple password so they don't expose real credentials.

## Security Measures Verified

Before writing any copy, the implementation was confirmed against the actual codebase:

| Measure | Where enforced |
|---|---|
| Password bcrypt hashing | Supabase Auth (built-in) |
| HTTPS / TLS | Supabase API layer |
| Session tokens in HTTPOnly cookies | `@supabase/ssr` + Next.js cookies API |
| Row-Level Security on all user tables | `packages/db/supabase/migrations/` |
| Security headers (CSP, X-Frame-Options, etc.) | `apps/web/next.config.ts` |
| Rate limiting | Server-side RPC `check_and_increment_rate_limit()` |
| OAuth token encryption at rest | `user_integrations.encrypted_tokens` |

All copy in the security footnote is grounded in these verified measures — no marketing claims.

## Design

### A. Demo Hint — amber callout, top of form (signup + login)

Positioned above the error block inside `<form>`. Matches existing error box pattern.

```
💡 ¿Explorando la demo?  Puedes usar un correo alterno y una contraseña
sencilla (mín. 6 caracteres) para probar las funciones sin comprometer
tus credenciales reales.
```

Rationale for showing on both pages: signup to set expectations when creating the account; login to remind users which email they may have used for demo purposes.

### B. Security Footnote — gray micro-text, bottom of signup form only

Positioned after the submit button. Extra-small (`text-xs`), neutral gray, with a lock SVG icon.

```
🔒  Contraseña cifrada · Cookies seguras HTTPOnly · Datos protegidos por Row-Level Security
```

Rationale for signup only: the commitment of credentials happens at signup. At login the user has already trusted the app.

## Files Changed

- `apps/web/src/app/signup/signup-form.tsx` — add demo hint (top) + security footnote (bottom)
- `apps/web/src/app/login/login-form.tsx` — add demo hint (top) only

No new components, no new files, no routing changes.

## Styling

Both additions use existing Tailwind + dark mode patterns from the same files:

- Demo hint: `rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300`
- Security footnote: `flex items-center justify-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 pt-2`

## Out of Scope

- No password strength meter
- No GDPR/privacy policy link
- No changes to form validation or Supabase config
