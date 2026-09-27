import { beforeEach, describe, expect, it, vi } from 'vitest';

let existing = false;
let taken = false;
const sent: string[] = [];

vi.mock('@/lib/db/signup', () => ({
  slugTaken: async () => taken,
  beginSignup: async () => (existing ? { kind: 'exists' } : { kind: 'confirm', link: 'https://x/verify' }),
}));
vi.mock('@/lib/signup-email', () => ({
  sendSignupConfirmEmail: async (to: string) => {
    sent.push(`confirm:${to}`);
    return 'sent';
  },
  sendAlreadyRegisteredEmail: async (to: string) => {
    sent.push(`exists:${to}`);
    return 'sent';
  },
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  enforceRateLimit: async () => undefined,
}));

const { POST } = await import('@/app/api/signup/route');

const form = {
  businessName: 'Mara Studio',
  slug: 'mara-studio',
  email: 'Mara@Example.com',
  password: 'longenough',
  timezone: 'Europe/Madrid',
};
const post = (body: unknown) =>
  POST(
    new Request('http://x/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  existing = false;
  taken = false;
  sent.length = 0;
});

describe('POST /api/signup', () => {
  it('answers a new address and a known one identically, and tells each by email', async () => {
    const first = await post(form);
    existing = true;
    const second = await post(form);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    expect(sent).toEqual(['confirm:mara@example.com', 'exists:mara@example.com']);
  });

  it('says plainly when the web address is taken — that is public anyway', async () => {
    taken = true;
    const response = await post(form);
    expect(response.status).toBe(409);
    expect(sent).toEqual([]);
  });

  it('refuses a weak password, a reserved address and an unknown time zone before anything is made', async () => {
    expect((await post({ ...form, password: 'short' })).status).toBe(400);
    expect((await post({ ...form, slug: 'admin' })).status).toBe(400);
    expect((await post({ ...form, timezone: 'Mars/Olympus' })).status).toBe(400);
    expect(sent).toEqual([]);
  });
});
