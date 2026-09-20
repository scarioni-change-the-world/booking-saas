/**
 * Authenticating a scheduled request.
 *
 * A cron endpoint is a public URL that does real work — sends mail, writes
 * rows — with no user session behind it, so a shared secret is the entire
 * security boundary. That makes this small function worth its own file and
 * its own tests rather than sitting inline in a route.
 *
 * Three rules, and each exists because its opposite is a real failure:
 *
 *   - No secret configured means no access. An unset environment variable
 *     must never be the thing that opens a door, and a naive comparison
 *     against an empty string lets everybody in — including a caller who
 *     sends no header at all.
 *   - The comparison does not exit early. Response time should carry no
 *     information about how many leading characters of a guess were right.
 *   - A wrong secret and a missing one are indistinguishable to the caller.
 */

/** Length first, then every byte, with no early exit. */
function constantTimeEquals(a: string, b: string): boolean {
  // Length is not secret — it is visible from the header anyway — and
  // comparing unequal lengths byte-wise is meaningless.
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

export function cronSecretConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET?.trim());
}

/**
 * Is this request carrying the scheduler's secret?
 *
 * Accepts `Authorization: Bearer <secret>`, which is what Vercel's scheduler
 * sends and what a person testing with curl can send by hand.
 */
export function isScheduledRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;

  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;

  return constantTimeEquals(header.slice(7), expected);
}
