import { describe, expect, it, vi } from 'vitest';
import { clientIp, enforceRateLimit, RateLimitError, RATE_LIMITS } from '@/lib/rate-limit';

function requestWith(headers: Record<string, string>): Request {
  return new Request('https://example.com/api/t/demo/bookings', { method: 'POST', headers });
}

describe('clientIp', () => {
  it('takes the first entry of x-forwarded-for — the client, not the proxies after it', () => {
    expect(clientIp(requestWith({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' }))).toBe(
      '203.0.113.7',
    );
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(requestWith({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('is "unknown" with no headers at all — one shared bucket, not one per caller', () => {
    expect(clientIp(requestWith({}))).toBe('unknown');
  });

  it('truncates something longer than any real address', () => {
    const absurd = 'x'.repeat(5000);
    expect(clientIp(requestWith({ 'x-forwarded-for': absurd }).clone()).length).toBe(45);
  });
});

describe('enforceRateLimit', () => {
  it('allows a request the counter says is within the limit', async () => {
    const consume = vi.fn().mockResolvedValue(true);
    await expect(
      enforceRateLimit(requestWith({ 'x-forwarded-for': '1.2.3.4' }), 'tenant-1', 'booking', { consume }),
    ).resolves.toBeUndefined();
  });

  it('throws RateLimitError once the counter refuses', async () => {
    const consume = vi.fn().mockResolvedValue(false);
    await expect(
      enforceRateLimit(requestWith({ 'x-forwarded-for': '1.2.3.4' }), 'tenant-1', 'booking', { consume }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('counts against a key of action, tenant and caller — so none of the three share a bucket', async () => {
    const consume = vi.fn().mockResolvedValue(true);
    await enforceRateLimit(requestWith({ 'x-forwarded-for': '1.2.3.4' }), 'tenant-1', 'booking', { consume });

    expect(consume).toHaveBeenCalledWith(
      'booking:tenant-1:1.2.3.4',
      RATE_LIMITS.booking.limit,
      RATE_LIMITS.booking.windowSeconds,
    );
  });

  it('uses each action’s own limit', async () => {
    const consume = vi.fn().mockResolvedValue(true);
    await enforceRateLimit(requestWith({}), 't1', 'qualification', { consume });

    expect(consume).toHaveBeenCalledWith(
      'qualification:t1:unknown',
      RATE_LIMITS.qualification.limit,
      RATE_LIMITS.qualification.windowSeconds,
    );
  });

  // What lets the client-link endpoint bound one *inbox* as well as one
  // caller: the same action, counted against the address asked about, so
  // spreading requests across IPs still can't mail-bomb a single person.
  it('counts against a subject instead of the caller when one is given', async () => {
    const consume = vi.fn().mockResolvedValue(true);
    await enforceRateLimit(requestWith({ 'x-forwarded-for': '1.2.3.4' }), 't1', 'clientLinkAddress', {
      subject: 'someone@example.com',
      consume,
    });

    expect(consume).toHaveBeenCalledWith(
      'clientLinkAddress:t1:someone@example.com',
      RATE_LIMITS.clientLinkAddress.limit,
      RATE_LIMITS.clientLinkAddress.windowSeconds,
    );
  });

  // The deliberate posture, spelled out in enforceRateLimit's own comment:
  // a business that cannot take a booking because a counter table blinked is
  // a worse outcome than an unthrottled window.
  it('fails open when the counter itself is unavailable', async () => {
    const consume = vi.fn().mockRejectedValue(new Error('connection refused'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      enforceRateLimit(requestWith({ 'x-forwarded-for': '1.2.3.4' }), 'tenant-1', 'booking', { consume }),
    ).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });
});
