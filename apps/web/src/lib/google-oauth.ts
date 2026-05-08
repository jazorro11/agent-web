/**
 * Callback URL registered in Google Cloud Console must match this value exactly.
 * Prefer NEXT_PUBLIC_SITE_URL in production (canonical public origin).
 */
export function getGoogleOAuthRedirectUri(request: Request): string {
  const url = new URL(request.url);
  const configuredBase =
    process.env.GOOGLE_OAUTH_BASE_URL ??
    (process.env.NODE_ENV === "production"
      ? process.env.NEXT_PUBLIC_SITE_URL
      : undefined);
  const base = configuredBase?.replace(/\/$/, "") ?? url.origin;
  return `${base}/api/integrations/google/callback`;
}
