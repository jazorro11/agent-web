import type { DbClient } from "../client";
import type { UserIntegration } from "@agents/types";

/** Active integration row fields needed for OAuth token refresh. */
export async function getActiveIntegrationCredentials(
  db: DbClient,
  userId: string,
  provider: string
): Promise<{ encrypted_tokens: string; expires_at: string | null } | null> {
  const { data, error } = await db
    .from("user_integrations")
    .select("encrypted_tokens, expires_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data?.encrypted_tokens) return null;
  return {
    encrypted_tokens: data.encrypted_tokens as string,
    expires_at: (data.expires_at as string | null) ?? null,
  };
}

export async function getUserIntegrations(db: DbClient, userId: string) {
  const { data, error } = await db
    .from("user_integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  return (data ?? []) as UserIntegration[];
}

export async function upsertIntegration(
  db: DbClient,
  userId: string,
  provider: string,
  scopes: string[],
  encryptedTokens: string,
  expiresAt?: string | null
) {
  const row: Record<string, unknown> = {
    user_id: userId,
    provider,
    scopes,
    encrypted_tokens: encryptedTokens,
    status: "active",
  };
  if (expiresAt !== undefined) {
    row.expires_at = expiresAt;
  }
  const { data, error } = await db
    .from("user_integrations")
    .upsert(row, { onConflict: "user_id,provider" })
    .select()
    .single();
  if (error) throw error;
  return data as UserIntegration;
}

/** Update encrypted tokens and expiry after OAuth refresh (e.g. Google). */
export async function updateIntegrationTokens(
  db: DbClient,
  userId: string,
  provider: string,
  encryptedTokens: string,
  expiresAt: string | null
) {
  const { error } = await db
    .from("user_integrations")
    .update({ encrypted_tokens: encryptedTokens, expires_at: expiresAt })
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw error;
}

export async function markIntegrationExpired(
  db: DbClient,
  userId: string,
  provider: string
) {
  const { error } = await db
    .from("user_integrations")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw error;
}

export async function revokeIntegration(
  db: DbClient,
  userId: string,
  provider: string
) {
  const { error } = await db
    .from("user_integrations")
    .update({ status: "revoked" })
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw error;
}
