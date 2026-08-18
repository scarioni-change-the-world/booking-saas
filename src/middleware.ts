import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-tenant frame-ancestors (brief 7.2).
 *
 * The reference implementation carried a hard-coded allowlist in vercel.json,
 * which cannot work once any number of tenants embed the widget on their own
 * sites. Each tenant registers its embed domains, and this middleware turns
 * those into the CSP for that tenant's pages.
 *
 * A tenant with no registered domains gets `frame-ancestors 'none'` — the
 * widget still works when opened directly, but cannot be framed. Defaulting to
 * `*` instead would let anyone embed any tenant's booking page on any site,
 * which is a clickjacking surface and a support problem.
 */

const TTL_MS = 60_000;

/**
 * Best-effort cache. Serverless instances are short-lived and not shared, so
 * this trims repeat lookups within one instance rather than acting as a real
 * cache — correctness never depends on a hit.
 */
const cache = new Map<string, { domains: string[]; expires: number }>();

async function embedDomains(slug: string): Promise<string[]> {
  const cached = cache.get(slug);
  if (cached && cached.expires > Date.now()) return cached.domains;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];

  try {
    const response = await fetch(
      `${url}/rest/v1/tenants?slug=eq.${encodeURIComponent(slug)}&select=embed_domains`,
      { headers: { apikey: key, authorization: `Bearer ${key}` } },
    );
    if (!response.ok) return [];

    const rows = (await response.json()) as Array<{ embed_domains: string[] }>;
    const domains = rows[0]?.embed_domains ?? [];
    cache.set(slug, { domains, expires: Date.now() + TTL_MS });
    return domains;
  } catch {
    // A lookup failure must not open the frame policy up.
    return [];
  }
}

export async function middleware(request: NextRequest) {
  const match = /^\/t\/([^/]+)/.exec(request.nextUrl.pathname);
  const response = NextResponse.next();

  if (!match) return response;

  const domains = await embedDomains(decodeURIComponent(match[1]!));
  const ancestors = domains.length > 0 ? domains.join(' ') : "'none'";

  response.headers.set('Content-Security-Policy', `frame-ancestors ${ancestors}`);
  return response;
}

export const config = {
  matcher: ['/t/:path*'],
};
