import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_SCOPE, RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';

const send = vi.fn();
let providerId = 'smtp';

vi.mock('@/lib/email', () => ({
  emailProvider: () => ({ id: providerId, send }),
}));

const { RECOVERY_LINK_HOURS, sendPasswordResetEmail } = await import('@/lib/password-reset-email');

const LINK = 'https://project.supabase.co/auth/v1/verify?token=abc&type=recovery';

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ id: 'message-1' });
  providerId = 'smtp';
});

describe('sendPasswordResetEmail', () => {
  /* The HTML version carries the link with its ampersands escaped, which is
     what belongs in an href — browsers read &amp; back as &, and the token
     survives. Asserted in its escaped form rather than loosened to a
     substring, so that if the escaping ever stops happening this notices. */
  it('carries the link in both the HTML and the plain-text version', async () => {
    await sendPasswordResetEmail('owner@example.com', LINK);

    const sent = send.mock.calls[0]![0];
    expect(sent.html).toContain(`href="${LINK.replace(/&/g, '&amp;')}"`);
    expect(sent.text).toContain(LINK);
  });

  it('sends from intro, not from any business — this is the one email the product sends on its own behalf', async () => {
    await sendPasswordResetEmail('owner@example.com', LINK);

    const sent = send.mock.calls[0]![0];
    expect(sent.fromName).toBe('intro');
    expect(sent.to).toEqual({ email: 'owner@example.com' });
    expect(sent.subject).toBe('Reset your intro password');
  });

  it('tells the reader nothing has changed if it was not them', async () => {
    await sendPasswordResetEmail('owner@example.com', LINK);

    expect(send.mock.calls[0]![0].text).toContain('your current password still works');
  });

  it('says how long the link lasts, in the same terms the API promises', async () => {
    await sendPasswordResetEmail('owner@example.com', LINK);

    expect(send.mock.calls[0]![0].text).toContain(`${RECOVERY_LINK_HOURS} hour`);
  });

  it('reports not_configured rather than pretending, when nothing is wired up to send', async () => {
    providerId = 'console';

    await expect(sendPasswordResetEmail('owner@example.com', LINK)).resolves.toBe('not_configured');
    expect(send).not.toHaveBeenCalled();
  });

  /* The route answers identically whether or not the address exists, and it
     can only keep that promise if a send failure comes back as a value. A
     throw here would become a 500 — visible only for addresses that really
     do have an account, which is the enumeration leak the whole endpoint is
     built to avoid. */
  it('returns failed rather than throwing when the mail server refuses', async () => {
    send.mockRejectedValue(new Error('550 mailbox unavailable'));

    await expect(sendPasswordResetEmail('owner@example.com', LINK)).resolves.toBe('failed');
  });
});

describe('password-reset rate limits', () => {
  it('counts the caller and the address against separate keys', async () => {
    const consume = vi.fn().mockResolvedValue(true);
    const request = new Request('https://example.com/api/admin/password-reset', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });

    await enforceRateLimit(request, PLATFORM_SCOPE, 'passwordResetRequest', { consume });
    await enforceRateLimit(request, PLATFORM_SCOPE, 'passwordResetAddress', {
      subject: 'owner@example.com',
      consume,
    });

    expect(consume.mock.calls[0]![0]).toBe('passwordResetRequest:platform:203.0.113.7');
    expect(consume.mock.calls[1]![0]).toBe('passwordResetAddress:platform:owner@example.com');
  });

  /* Spreading requests across IPs must not be a way around the per-address
     limit, so the address limit has to be the tighter of the two. */
  it('lets one inbox receive fewer than one caller can ask for', () => {
    expect(RATE_LIMITS.passwordResetAddress.limit).toBeLessThan(
      RATE_LIMITS.passwordResetRequest.limit,
    );
  });
});
