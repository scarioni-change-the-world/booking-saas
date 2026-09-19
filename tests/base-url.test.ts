import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseUrl } from '@/lib/base-url';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('baseUrl', () => {
  it('uses PUBLIC_BASE_URL when it is set — the only one anybody chose', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://book.example.com');
    expect(baseUrl()).toBe('https://book.example.com');
  });

  it('wins over the Vercel variables even when both are present', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://book.example.com');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'my-app.vercel.app');
    vi.stubEnv('VERCEL_URL', 'my-app-abc123.vercel.app');
    expect(baseUrl()).toBe('https://book.example.com');
  });

  it('trims a trailing slash, so links never come out doubled', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://book.example.com///');
    expect(baseUrl()).toBe('https://book.example.com');
  });

  it('falls back to the stable Vercel production URL, adding the scheme Vercel omits', () => {
    vi.stubEnv('PUBLIC_BASE_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'my-app.vercel.app');
    expect(baseUrl()).toBe('https://my-app.vercel.app');
  });

  // The per-deployment URL changes on every push, so a manage link built
  // from it stops resolving as soon as the next deploy lands. It is the
  // last resort, not the first.
  it('prefers the production URL over the per-deployment one', () => {
    vi.stubEnv('PUBLIC_BASE_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'my-app.vercel.app');
    vi.stubEnv('VERCEL_URL', 'my-app-abc123.vercel.app');
    expect(baseUrl()).toBe('https://my-app.vercel.app');
  });

  it('uses the per-deployment URL only when nothing better exists', () => {
    vi.stubEnv('PUBLIC_BASE_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
    vi.stubEnv('VERCEL_URL', 'my-app-abc123.vercel.app');
    expect(baseUrl()).toBe('https://my-app-abc123.vercel.app');
  });

  // Returning '' rather than throwing: email is best-effort and must never
  // be why a booking fails. A broken link is bad; a refused booking is worse.
  it('returns an empty string when nothing is set, rather than throwing', () => {
    vi.stubEnv('PUBLIC_BASE_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
    vi.stubEnv('VERCEL_URL', '');
    expect(baseUrl()).toBe('');
  });

  it('ignores whitespace-only values', () => {
    vi.stubEnv('PUBLIC_BASE_URL', '   ');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'my-app.vercel.app');
    expect(baseUrl()).toBe('https://my-app.vercel.app');
  });
});
