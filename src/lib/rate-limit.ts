import { consumeRateLimit } from './db';

/**
 * Rate limiting for the public booking surface.
 *
 * Everything under /t/[slug] is deliberately unauthenticated — a prospect
 * is anonymous, that is the whole point of the front door — which means the
 * usual "who is this" answer that bounds abuse everywhere else in this app
 * (a bearer token, a manage token, a client token) simply doesn't exist
 * here. This is what stands in for it.
 *
 * The counting happens in Postgres (migration 0019) rather than in memory,
 * because this app runs serverless and an in-process counter only ever sees
 * one instance's share of the traffic.
 */

export class RateLimitError extends Error {
  readonly status = 429;

  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * What each limited action allows, per tenant, per caller, per window.
 *
 * Both are generous against how a real person behaves — someone books once,
 * maybe twice if they fumble, and starts the questionnaire a handful of
 * times at most — and tight against a script. They are per (action, tenant,
 * IP) rather than per tenant alone, deliberately: a single global ceiling
 * per tenant would let one abusive caller lock a whole business out of its
 * own booking page, which is a worse outcome than the abuse.
 *
 * .../qualify (completing a questionnaire) has no limit of its own on
 * purpose — it can only ever act on a response id that .../qualify/start
 * handed out, so the limit below already bounds it.
 */
export const RATE_LIMITS = {
  booking: {
    limit: 10,
    windowSeconds: 3600,
    message: 'Too many bookings from here just now. Please try again in a little while.',
  },
  qualification: {
    limit: 30,
    windowSeconds: 3600,
    message: 'Too many attempts from here just now. Please try again in a little while.',
  },
  /**
   * Asking for a client's own booking link to be re-sent. Tighter than the
   * other two because this one *sends mail to an address the caller chose*,
   * which makes it the only endpoint here that can be pointed at a third
   * party. Limited twice over — see the two entries — so that neither one
   * caller nor one victim's inbox can be flooded through it.
   */
  clientLinkRequest: {
    limit: 5,
    windowSeconds: 3600,
    message: 'Too many requests from here just now. Please try again in a little while.',
  },
  /** The same endpoint, counted per address asked about rather than per
   * caller, so spreading the requests across IPs still can't mail-bomb one
   * person. Its message is never actually shown for a real address — see
   * the route, which answers identically either way. */
  clientLinkAddress: {
    limit: 3,
    windowSeconds: 3600,
    message: 'Too many requests for that address just now. Please try again in a little while.',
  },
} as const;

export type RateLimitedAction = keyof typeof RATE_LIMITS;

/** The longest a textual IPv6 address can be — anything longer is not an
 * address, and a key is a primary key, so it should not be attacker-sized. */
const MAX_IP_LENGTH = 45;

/**
 * The caller's IP, as the platform reports it.
 *
 * `x-forwarded-for` is a list, oldest first, so the client is the first
 * entry. On Vercel (and any proxy that overwrites rather than appends to a
 * client-supplied header) that entry is trustworthy; behind one that
 * doesn't, a caller can put whatever they like there. That is a real
 * limitation and worth being plain about: this bounds casual abuse and
 * accidents, and is not an authorization boundary. Nothing is granted on
 * the strength of this value — it only ever decides which counter a request
 * is counted against.
 *
 * With no header at all (local dev, a direct call) every caller shares one
 * bucket, which is the safe direction to be wrong in.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const candidate = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim();

  if (!candidate) return 'unknown';
  return candidate.slice(0, MAX_IP_LENGTH);
}

/**
 * Count one attempt, and throw RateLimitError (a 429, via handleError) if
 * the caller is over the limit for this action.
 *
 * Fails **open**: if the counter itself is unreachable, the request is
 * allowed and the failure is logged loudly. This is the opposite of the
 * posture middleware.ts takes for frame-ancestors, and the difference is
 * what each failure costs. There, failing open leaves a real hole standing
 * for as long as the outage lasts. Here, it costs only throttling — while
 * failing closed would mean a business stops being able to take bookings at
 * all because a counter table was briefly unavailable, which is a worse
 * outcome than the abuse this prevents.
 *
 * `subject` counts against something other than the caller's IP — an email
 * address, for an endpoint that can be aimed at a third party. Two calls
 * with different subjects are two independent limits, and an endpoint that
 * needs both simply enforces both.
 *
 * @param options.consume injectable for tests; production callers omit it —
 *   the same shape as tenantScope's own optional client.
 */
export async function enforceRateLimit(
  request: Request,
  tenantId: string,
  action: RateLimitedAction,
  options: { subject?: string; consume?: typeof consumeRateLimit } = {},
): Promise<void> {
  const { consume = consumeRateLimit, subject } = options;
  const { limit, windowSeconds, message } = RATE_LIMITS[action];
  const key = `${action}:${tenantId}:${subject ?? clientIp(request)}`;

  let allowed: boolean;
  try {
    allowed = await consume(key, limit, windowSeconds);
  } catch (cause) {
    console.error('[rate-limit] counter unavailable, allowing the request:', cause);
    return;
  }

  if (!allowed) throw new RateLimitError(message);
}
