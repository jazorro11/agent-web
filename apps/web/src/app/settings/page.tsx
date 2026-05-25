import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: toolSettings } = await supabase
    .from("user_tool_settings")
    .select("*")
    .eq("user_id", user.id);

  const { data: telegramAccount } = await supabase
    .from("telegram_accounts")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const { data: githubIntegration } = await supabase
    .from("user_integrations")
    .select("*")
    .eq("user_id", user.id)
    .eq("provider", "github")
    .maybeSingle();

  const { data: googleIntegration } = await supabase
    .from("user_integrations")
    .select("*")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .maybeSingle();

  const { data: notionIntegration } = await supabase
    .from("user_integrations")
    .select("*")
    .eq("user_id", user.id)
    .eq("provider", "notion")
    .maybeSingle();

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <h1 className="text-lg font-semibold">Ajustes</h1>
          <a
            href="/chat"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Volver al chat
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <SettingsForm
          userId={user.id}
          profile={profile}
          isDemoUser={(profile as Record<string, unknown>)?.is_demo_user === true}
          toolSettings={toolSettings ?? []}
          telegramLinked={!!telegramAccount}
          githubConnected={githubIntegration?.status === "active"}
          googleConnected={googleIntegration?.status === "active"}
          notionConnected={notionIntegration?.status === "active"}
        />
      </main>
    </div>
  );
}
