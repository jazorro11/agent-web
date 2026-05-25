import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "./wizard";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_completed) redirect("/chat");

  const { data: toolSettings } = await supabase
    .from("user_tool_settings")
    .select("*")
    .eq("user_id", user.id);

  const isDemoUser = (profile as Record<string, unknown>)?.is_demo_user === true;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <OnboardingWizard
          userId={user.id}
          initialProfile={profile}
          initialToolSettings={toolSettings ?? []}
          isDemoUser={isDemoUser}
        />
      </div>
    </main>
  );
}
