import { createHmac } from 'node:crypto';

/**
 * khloe's own website counter (khloe.io), in place of a paid analytics
 * service. Privacy by construction (migration 0041):
 *
 * - Nothing is stored on the visitor's device: no cookies, no storage.
 * - No IP address and no browser string is kept. `visitor` is a 16-letter
 *   code made from them with a secret that includes the day, so it counts
 *   "the same visitor today", cannot be turned back into either, and today's
 *   code cannot be matched with tomorrow's.
 * - A browser that asks not to be tracked (Do Not Track, Global Privacy
 *   Control) is not counted at all.
 * - Where a visitor came from is kept as a host only (instagram.com).
 *
 * Pure apart from the hash, so the route stays thin and this is testable.
 */

export const SITE_KINDS = ['pageview', 'Start free', 'Sign in', 'Demo started', 'Demo booked'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

const PLACES = ['header', 'hero', 'price', 'closing', 'demo'] as const;

export interface SiteHit {
  kind: SiteKind;
  path: string;
  source: string | null;
  place: string | null;
  device: 'phone' | 'tablet' | 'computer';
  country: string | null;
}

const BOT = /bot|crawl|spider|slurp|preview|fetch|monitor|headless|lighthouse|pingdom|curl|wget|python|httpclient|axios|node-fetch|go-http/i;

/** A browser that asked not to be tracked, or a robot: not counted. */
export function notCounted(headers: Headers): boolean {
  if (headers.get('sec-gpc') === '1' || headers.get('dnt') === '1') return true;
  const ua = headers.get('user-agent') ?? '';
  return !ua || BOT.test(ua);
}

export function deviceOf(userAgent: string): SiteHit['device'] {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(userAgent)) return 'phone';
  return 'computer';
}

/** A referrer reduced to its host; null when it is khloe itself or unreadable. */
export function sourceOf(referrer: unknown, ownHosts: string[]): string | null {
  if (typeof referrer !== 'string' || !referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    if (!host || ownHosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
    return host.slice(0, 100);
  } catch {
    return null;
  }
}

/**
 * The note a page sends, checked: an unknown kind, a missing path or
 * anything odd is refused (null), never guessed at.
 */
export function readHit(
  body: unknown,
  ctx: { userAgent: string; country: string | null; ownHosts: string[] },
): SiteHit | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const kind = SITE_KINDS.find((k) => k === b.kind);
  if (!kind) return null;
  if (typeof b.path !== 'string' || !b.path.startsWith('/')) return null;
  // The page only: no query string or fragment, which can carry personal data.
  const path = b.path.split(/[?#]/)[0]!.slice(0, 200);
  const place = typeof b.place === 'string' && (PLACES as readonly string[]).includes(b.place) ? b.place : null;
  const country = ctx.country && /^[A-Z]{2}$/.test(ctx.country) ? ctx.country : null;
  return {
    kind,
    path,
    source: kind === 'pageview' ? sourceOf(b.referrer, ctx.ownHosts) : null,
    place,
    device: deviceOf(ctx.userAgent),
    country,
  };
}

/** Today's code for this visitor: same all day, unlinkable across days. */
export function visitorCode(secret: string, day: string, ip: string, userAgent: string): string {
  return createHmac('sha256', `${secret}:${day}`).update(`${ip}\n${userAgent}`).digest('hex').slice(0, 16);
}

/* ── For the console ─────────────────────────────────────────────────── */

export interface SiteRow {
  day: string;
  kind: SiteKind;
  source: string | null;
  place: string | null;
  device: SiteHit['device'];
  visitor: string;
}

/** Visitors are counted once a day each, as the code allows. */
function visitors(rows: SiteRow[]): number {
  return new Set(rows.filter((r) => r.kind === 'pageview').map((r) => `${r.day}:${r.visitor}`)).size;
}

export function siteSummary(rows: SiteRow[], previous: SiteRow[]) {
  const count = (list: SiteRow[], kind: SiteKind) => list.filter((r) => r.kind === kind).length;
  const v = visitors(rows);
  const sources = new Map<string, number>();
  for (const r of rows) if (r.kind === 'pageview') sources.set(r.source ?? 'Direct', (sources.get(r.source ?? 'Direct') ?? 0) + 1);
  const devices = { phone: 0, tablet: 0, computer: 0 };
  for (const r of rows) if (r.kind === 'pageview') devices[r.device] += 1;
  const startFree = count(rows, 'Start free');
  return {
    visitors: { now: v, before: visitors(previous) },
    pageviews: count(rows, 'pageview'),
    startFree: { now: startFree, before: count(previous, 'Start free') },
    startFreeRate: v > 0 ? Math.round((startFree / v) * 1000) / 10 : null,
    signIn: count(rows, 'Sign in'),
    demo: { started: count(rows, 'Demo started'), booked: count(rows, 'Demo booked') },
    sources: [...sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([host, n]) => ({ host, n })),
    devices,
  };
}

export type SiteSummary = ReturnType<typeof siteSummary>;
