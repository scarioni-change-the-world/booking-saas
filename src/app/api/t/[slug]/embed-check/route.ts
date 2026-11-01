import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/api';
import { baseUrl } from '@/lib/base-url';
import { sightingPage } from '@/lib/embed';
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit';

/** Most sites a business is ever seen on; past it, new ones are not recorded. */
const MAX_SITES = 50;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
};

function done(status = 204) {
  return new NextResponse(null, { status, headers: CORS });
}

export function OPTIONS() {
  return done();
}

/**
 * embed.js, from the page a business pasted its code into: "I am on this
 * page, and the booking page inside me loaded (or did not)". Share turns
 * it into "Working on www.yourstudio.com/book", or "Your code is on X,
 * which isn't allowed yet".
 *
 * Called from other people's sites, so it is open to any origin, takes a
 * text/plain body (a beacon, no preflight), answers nothing useful, and
 * never fails loudly: the host page must not notice it. What it keeps is
 * a site address and a yes or no — nothing about the visitor.
 *
 * Anyone can call it with any address, so a report proves nothing on its
 * own. Share treats it as a hint, and allowing a reported site checks the
 * page itself for the code first (share/allow).
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (resolved instanceof NextResponse) return done();

    const text = (await request.text()).slice(0, 4000);
    let body: { page?: unknown; ok?: unknown };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return done(400);
    }
    const page = sightingPage(body.page);
    if (!page || typeof body.ok !== 'boolean') return done(400);

    // The app framing its own page (Flow's test run) is not a website.
    if (page.host === safeHost(baseUrl()) || page.host === safeHost(request.url)) return done();

    await enforceRateLimit(request, resolved.tenant.id, 'embedCheck');

    const scope = resolved.scope;
    const existing = await scope.select('embed_sightings', 'host');
    if (existing.error) {
      // Before migration 0034 there is nowhere to keep it.
      if (existing.error.code === '42P01' || existing.error.code === 'PGRST205') return done();
      throw existing.error;
    }
    const known = (existing.data as unknown as Array<{ host: string }>).some((r) => r.host === page.host);
    if (!known && existing.data.length >= MAX_SITES) return done();

    const { error } = await scope.upsert(
      'embed_sightings',
      { host: page.host, page_url: page.pageUrl, ok: body.ok, seen_at: new Date().toISOString() },
      'tenant_id,host',
    );
    if (error) throw error;
    return done();
  } catch (error) {
    if (error instanceof RateLimitError) return done(429);
    console.error('[embed-check]', error);
    return done(500);
  }
}

function safeHost(url: string): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}
