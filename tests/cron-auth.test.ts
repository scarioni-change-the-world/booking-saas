import { afterEach, describe, expect, it, vi } from 'vitest';
import { cronSecretConfigured, isScheduledRequest } from '@/lib/cron-auth';

afterEach(() => {
  vi.unstubAllEnvs();
});

function withHeader(value?: string): Request {
  return new Request('https://example.com/api/cron/reminders', {
    headers: value === undefined ? {} : { authorization: value },
  });
}

/**
 * A cron endpoint is a public URL that sends real mail with no user session
 * behind it. This comparison is the entire security boundary, which is why
 * it has a file and a test file rather than three lines inside a route.
 */
describe('isScheduledRequest', () => {
  it('accepts the configured secret', () => {
    vi.stubEnv('CRON_SECRET', 'correct-horse-battery-staple');
    expect(isScheduledRequest(withHeader('Bearer correct-horse-battery-staple'))).toBe(true);
  });

  it('rejects a wrong secret of the same length', () => {
    vi.stubEnv('CRON_SECRET', 'aaaaaaaaaaaa');
    expect(isScheduledRequest(withHeader('Bearer bbbbbbbbbbbb'))).toBe(false);
  });

  it('rejects a secret that is a prefix of the real one', () => {
    vi.stubEnv('CRON_SECRET', 'super-secret-value');
    expect(isScheduledRequest(withHeader('Bearer super'))).toBe(false);
  });

  /* The one that matters most. An unset variable must never be the thing
     that opens a door — and a naive comparison against '' would let in a
     caller who sends "Bearer " and nothing after it, or no header at all. */
  describe('refuses everything when no secret is configured', () => {
    for (const [name, header] of [
      ['no header', undefined],
      ['empty bearer', 'Bearer '],
      ['empty string', ''],
      ['a guess', 'Bearer anything'],
    ] as const) {
      it(name, () => {
        vi.stubEnv('CRON_SECRET', '');
        expect(isScheduledRequest(withHeader(header))).toBe(false);
      });
    }
  });

  it('refuses a blank secret that is only whitespace', () => {
    vi.stubEnv('CRON_SECRET', '   ');
    expect(isScheduledRequest(withHeader('Bearer    '))).toBe(false);
  });

  it('requires the Bearer scheme, not a bare secret', () => {
    vi.stubEnv('CRON_SECRET', 'a-secret');
    expect(isScheduledRequest(withHeader('a-secret'))).toBe(false);
    expect(isScheduledRequest(withHeader('Basic a-secret'))).toBe(false);
  });

  /* Written first as "padding must not pass", which failed — and the code
     was right. The Fetch spec normalises header values, stripping leading
     and trailing whitespace before anything here can see it, so a trailing
     space is invisible rather than tolerated. Recorded as the behaviour it
     is: no weakening, since a caller still has to know every byte of the
     secret, but not an assumption to carry around unexamined either. */
  it('never sees surrounding whitespace, because the platform strips it', () => {
    vi.stubEnv('CRON_SECRET', 'a-secret');
    expect(isScheduledRequest(withHeader('Bearer a-secret '))).toBe(true);
    // Whitespace *inside* the secret is a different matter and must not pass.
    expect(isScheduledRequest(withHeader('Bearer a-sec ret'))).toBe(false);
  });
});

describe('cronSecretConfigured', () => {
  it('is false for unset and for whitespace', () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(cronSecretConfigured()).toBe(false);
    vi.stubEnv('CRON_SECRET', '  ');
    expect(cronSecretConfigured()).toBe(false);
  });

  it('is true once a real value is set', () => {
    vi.stubEnv('CRON_SECRET', 'x');
    expect(cronSecretConfigured()).toBe(true);
  });
});
