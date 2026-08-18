import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Per-tenant frame-ancestors is applied in middleware.ts, driven by each
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
    ];
  },
};

export default config;
