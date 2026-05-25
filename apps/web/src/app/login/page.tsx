import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Ingresa a tu cuenta para acceder al agente.
          </p>
        </div>
        <LoginForm />
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-neutral-200 dark:border-neutral-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-neutral-400 dark:bg-neutral-950">o</span>
          </div>
        </div>
        <a
          href="/api/auth/demo-session"
          className="flex w-full items-center justify-center rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          Ver demo en vivo →
        </a>
        <p className="text-center text-sm text-neutral-500">
          ¿No tienes cuenta?{" "}
          <a href="/signup" className="text-blue-600 hover:underline">
            Crear cuenta
          </a>
        </p>
      </div>
    </main>
  );
}
