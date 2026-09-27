import Stripe from 'stripe';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const seen = new Set<string>();
const recorded: string[] = [];
const handled: string[] = [];
let handlerFails = false;

vi.mock('@/lib/db/billing', () => ({
  stripeEventSeen: async (id: string) => seen.has(id),
  recordStripeEvent: async (id: string) => {
    seen.add(id);
    recorded.push(id);
  },
}));
vi.mock('@/lib/stripe-webhook', () => ({
  handleStripeEvent: async (event: { id: string }) => {
    if (handlerFails) throw new Error('database down');
    handled.push(event.id);
  },
}));

const PLATFORM = 'whsec_platform_test';
const CONNECT = 'whsec_connect_test';
const saved = { ...process.env };
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = PLATFORM;
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT;

const { POST } = await import('@/app/api/stripe/webhook/route');
const signer = new Stripe('sk_test_dummy');

function delivery(id: string, secret: string | null, tamper = false) {
  const payload = JSON.stringify({
    id,
    object: 'event',
    type: 'account.updated',
    data: { object: {} },
  });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (secret)
    headers['stripe-signature'] = signer.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
  return new Request('http://x/api/stripe/webhook', {
    method: 'POST',
    headers,
    body: tamper ? payload.replace('account.updated', 'account.deleted') : payload,
  });
}

beforeEach(() => {
  seen.clear();
  recorded.length = 0;
  handled.length = 0;
  handlerFails = false;
});

afterAll(() => {
  process.env = saved;
});

describe('the Stripe webhook', () => {
  it('accepts an event signed with either endpoint’s secret', async () => {
    expect((await POST(delivery('evt_1', PLATFORM))).status).toBe(200);
    expect((await POST(delivery('evt_2', CONNECT))).status).toBe(200);
    expect(handled).toEqual(['evt_1', 'evt_2']);
    expect(recorded).toEqual(['evt_1', 'evt_2']);
  });

  it('acts on nothing unsigned, wrongly signed or altered', async () => {
    expect((await POST(delivery('evt_3', null))).status).toBe(400);
    expect((await POST(delivery('evt_4', 'whsec_someone_else'))).status).toBe(400);
    expect((await POST(delivery('evt_5', PLATFORM, true))).status).toBe(400);
    expect(handled).toEqual([]);
  });

  it('handles a repeated delivery once', async () => {
    await POST(delivery('evt_6', PLATFORM));
    const again = await POST(delivery('evt_6', PLATFORM));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(handled).toEqual(['evt_6']);
  });

  it('answers 500 and records nothing when handling fails, so Stripe retries', async () => {
    handlerFails = true;
    expect((await POST(delivery('evt_7', PLATFORM))).status).toBe(500);
    expect(recorded).toEqual([]);
    handlerFails = false;
    expect((await POST(delivery('evt_7', PLATFORM))).status).toBe(200);
    expect(handled).toEqual(['evt_7']);
  });
});
