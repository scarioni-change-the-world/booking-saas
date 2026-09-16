import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Per-tenant frame-ancestors is applied in proxy.ts, driven by each
  // tenant's registered embed domains (brief 7.2). No global allowlist here.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      // The tenant dashboard, the platform's own cross-tenant console, and a
      // client's booking-management page are never meant to be framed by
      // anyone — unlike /t/[slug], which brief 7.2's per-tenant policy above
      // exists specifically to allow. Left unset, these had no clickjacking
      // defence at all: auth here is a bearer token read from the browser's
      // own localStorage, not a cookie, so an attacker cannot forge the
      // request itself — but a real, already-signed-in admin (or, for
      // /console, platform staff with cross-tenant reach) can still be
      // tricked into clicking a disguised control inside an invisible iframe
      // of their own real dashboard. Deliberately excludes /t/:path* — this
      // matcher and that route's own proxy.ts header must never overlap,
      // since a browser intersects multiple Content-Security-Policy headers
      // rather than letting one override the other, and 'none' intersected
      // with anything is still 'none'.
      {
        source: '/admin/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: '/console/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: '/manage/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default config;
