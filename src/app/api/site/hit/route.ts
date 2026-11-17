import { __unsafeServiceClient } from '@/lib/db/client';
import { clientIp } from '@/lib/rate-limit';
import { notCounted, readHit, visitorCode } from '@/lib/site-hits';

/**
 * khloe.io's visitor counter (src/lib/site-hits.ts, migration 0041).
 *
 * Called by the marketing site with navigator.sendBeacon: plain text that
 * holds JSON, so no preflight. Always answers 204, counted or not, so the
 * page never waits on it or learns anything from it.
 *
 * Only khloe's own website may send here (SITE_ORIGINS, comma-separated;
 * khloe.io and www.khloe.io when unset).
 */

const DEFAULT_ORIGINS = ['https://khloe.io', 'https://www.khloe.io'];

function allowedOrigins(): string[] {
  const set = process.env.SITE_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  return set && set.length > 0 ? set : DEFAULT_ORIGINS;
}

function cors(origin: string | null): Record<string, string> {
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request.headers.get('origin')) });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const headers = cors(origin);
  const done = () => new Response(null, { status: 204, headers });
  try {
    if (!headers['access-control-allow-origin']) return done();
    if (notCounted(request.headers)) return done();

    const text = await request.text();
    if (text.length > 2000) return done();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return done();
    }

    const userAgent = request.headers.get('user-agent') ?? '';
    const ownHosts = allowedOrigins().map((o) => new URL(o).hostname.replace(/^www\./, ''));
    const hit = readHit(body, {
      userAgent,
      country: request.headers.get('x-vercel-ip-country'),
      ownHosts,
    });
    if (!hit) return done();

    const secret = process.env.SITE_COUNTER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!secret) return done();
    const day = new Date().toISOString().slice(0, 10);
    const { error } = await __unsafeServiceClient()
      .from('site_hits')
      .insert({ ...hit, day, visitor: visitorCode(secret, day, clientIp(request), userAgent) });
    if (error) console.error('[site-hit] not recorded:', error.message);
  } catch (cause) {
    console.error('[site-hit]', (cause as Error).message);
  }
  return done();
}
