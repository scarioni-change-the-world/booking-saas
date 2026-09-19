/**
 * The app's own public base URL — for the links that leave the app and have
 * to survive the trip: the manage link inside a booking confirmation, a
 * client's private booking link, and the redirect back into the dashboard
 * after Google's OAuth callback.
 *
 * PUBLIC_BASE_URL wins whenever it is set, because it is the only one of
 * these that somebody chose. The fallbacks exist because the most likely
 * moment to be missing it is the very first deploy — before anyone knows
 * what the URL is going to be — and the failure mode is quiet and bad: an
 * email that ships a relative "/manage/abc123", which is not a link at all
 * once it is sitting in someone's inbox.
 *
 * VERCEL_PROJECT_PRODUCTION_URL is preferred over VERCEL_URL deliberately.
 * VERCEL_URL is per-deployment and changes on every push, so a manage token
 * emailed today would point at a deployment that is no longer current
 * tomorrow. The production URL is the stable one, which is the only kind
 * worth putting in an email somebody keeps.
 *
 * Returns '' when nothing is set rather than throwing. Email is best-effort
 * and must never be the reason a booking fails (see booking-email.ts) — a
 * broken link is bad, a refused booking is worse.
 */
export function baseUrl(): string {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) return stripTrailingSlashes(explicit);

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  // Vercel supplies a bare host, with no scheme, and always serves https.
  if (vercelHost) return `https://${stripTrailingSlashes(vercelHost)}`;

  return '';
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}
