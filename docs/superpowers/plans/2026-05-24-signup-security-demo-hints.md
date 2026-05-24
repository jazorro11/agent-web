# Signup Security Footnote & Demo Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a demo-hint callout and a security footnote to the signup/login forms without introducing new components or files.

**Architecture:** Pure JSX additions inside existing form components. The demo hint (amber callout) renders at the top of each form; the security footnote (gray micro-text) renders at the bottom of the signup form only. No state, no props, no new files.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS v4, TypeScript

---

## File Map

| File | Change |
|---|---|
| `apps/web/src/app/signup/signup-form.tsx` | Add demo hint block at top of `<form>` + security footnote block after submit button |
| `apps/web/src/app/login/login-form.tsx` | Add demo hint block at top of `<form>` only |

---

### Task 1: Add demo hint + security footnote to signup form

**Files:**
- Modify: `apps/web/src/app/signup/signup-form.tsx`

> No test suite exists in this repo (`npm test` is not configured). Verification is done by diffing the output against the spec.

- [ ] **Step 1: Edit `signup-form.tsx` — add demo hint at the top of `<form>` and security footnote after the submit button**

The final `return` block must look exactly like this (only the JSX changes, the logic above stays untouched):

```tsx
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        <span className="font-medium">💡 ¿Explorando la demo?</span>{" "}
        Puedes usar un correo alterno y una contraseña sencilla (mín. 6
        caracteres) para probar las funciones sin comprometer tus credenciales
        reales.
      </div>
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">
          Correo electrónico
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Creando cuenta..." : "Crear cuenta"}
      </button>
      <p className="flex items-center justify-center gap-1.5 pt-1 text-xs text-neutral-500 dark:text-neutral-400">
        <svg
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
        Contraseña cifrada · Cookies seguras HTTPOnly · Datos protegidos por
        Row-Level Security
      </p>
    </form>
  );
```

- [ ] **Step 2: Verify the file compiles**

```bash
npm run type-check -w @agents/web
```

Expected: no errors. If there are errors, fix them before committing.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/signup/signup-form.tsx
git -c skill.commit=true commit -m "feat(signup): add demo hint callout and security footnote"
```

---

### Task 2: Add demo hint to login form

**Files:**
- Modify: `apps/web/src/app/login/login-form.tsx`

- [ ] **Step 1: Edit `login-form.tsx` — add demo hint at the top of `<form>`**

The final `return` block must look exactly like this:

```tsx
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        <span className="font-medium">💡 ¿Explorando la demo?</span>{" "}
        Si creaste tu cuenta con un correo alterno, úsalo aquí para
        iniciar sesión.
      </div>
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">
          Correo electrónico
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Ingresando..." : "Iniciar sesión"}
      </button>
    </form>
  );
```

Note: the login hint text is slightly different from signup — it reminds the user which email they used, rather than suggesting they create one.

- [ ] **Step 2: Verify the file compiles**

```bash
npm run type-check -w @agents/web
```

Expected: no errors.

- [ ] **Step 3: Commit and push**

```bash
git add apps/web/src/app/login/login-form.tsx
git -c skill.commit=true commit -m "feat(login): add demo hint callout"
git push origin claude/lucid-mendel-f8a614
```
