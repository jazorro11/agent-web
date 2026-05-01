/**
 * Callback URL registered in the GitHub OAuth App must match this value exactly.
 * Prefer NEXT_PUBLIC_SITE_URL in production (canonical public origin).
 */
export function getGithubOAuthRedirectUri(request: Request): string {
  const url = new URL(request.url);
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? url.origin;
  return `${base}/api/integrations/github/callback`;
}
