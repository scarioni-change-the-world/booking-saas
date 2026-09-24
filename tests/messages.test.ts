import { describe, expect, it, vi } from 'vitest';
import {
  MESSAGES,
  MOMENTS,
  describeTally,
  previewEmail,
  reminderLocalTime,
  sampleLinks,
  sampleTokens,
  tallySends,
} from '@/lib/messages';
import { TEMPLATE_TOKENS } from '@/lib/email/templates';
import { logEmailSend } from '@/lib/email-log';
import type { TenantScope } from '@/lib/db';

const NOW = '2026-09-24T10:00:00Z';
const TZ = 'Europe/Madrid';

describe('the journey', () => {
  it('pins every email kind to exactly one moment, and the next-steps message too', () => {
    const pinned = MOMENTS.flatMap((m) => m.messages);
    expect(new Set(pinned).size).toBe(pinned.length);
    expect(pinned.sort()).toEqual([...Object.keys(TEMPLATE_TOKENS), 'next_steps'].sort());
  });

  it('describes every message', () => {
    for (const id of MOMENTS.flatMap((m) => m.messages)) expect(MESSAGES[id].when).not.toBe('');
  });

  it('says when the reminder run happens in the business’s own time', () => {
    expect(reminderLocalTime(TZ, NOW)).toBe('10:00'); // 08:00 UTC in summer
    expect(reminderLocalTime(TZ, '2026-12-01T10:00:00Z')).toBe('09:00');
  });
});

describe('counting what arrived', () => {
  it('keeps failed apart from not sent', () => {
    const t = tallySends([
      { kind: 'booking_confirmed', status: 'sent' },
      { kind: 'booking_confirmed', status: 'sent' },
      { kind: 'booking_confirmed', status: 'failed' },
      { kind: 'client_invite', status: 'not_configured' },
    ]);
    expect(t.booking_confirmed).toEqual({ sent: 2, failed: 1, notSent: 0 });
    expect(t.client_invite).toEqual({ sent: 0, failed: 0, notSent: 1 });
    expect(t.booking_reminder).toEqual({ sent: 0, failed: 0, notSent: 0 });
  });

  it('says it in the fewest true words', () => {
    expect(describeTally({ sent: 11, failed: 0, notSent: 0 })).toBe('11 sent');
    expect(describeTally({ sent: 1, failed: 1, notSent: 0 })).toBe('1 sent · 1 failed');
    expect(describeTally({ sent: 0, failed: 0, notSent: 4 })).toBe('4 not sent');
    expect(describeTally({ sent: 0, failed: 0, notSent: 0 })).toBe('0 sent');
  });
});

describe('the preview', () => {
  const tokens = sampleTokens({ tenantName: 'Ruiz Photography', serviceName: 'Portrait session', timezone: TZ, nowIso: NOW });

  it('fills the wording with believable details in the business’s zone', () => {
    const p = previewEmail(
      'booking_confirmed',
      { subject: 'You’re booked with {{tenantName}}', body: 'Hi {{clientName}}, {{serviceName}} on {{dateTime}}.' },
      tokens,
      [],
    );
    expect(p.subject).toBe('You’re booked with Ruiz Photography');
    expect(p.body).toBe('Hi Maya, Portrait session on Thursday, October 1 at 10:00 AM.');
  });

  it('leaves a token this kind never fills as written, and names it', () => {
    const p = previewEmail('client_invite', { subject: 'Hi', body: '{{clientName}} on {{dateTime}} {{typo}}' }, tokens, []);
    expect(p.body).toBe('Maya on {{dateTime}} {{typo}}');
    expect(p.unknownTokens).toEqual(['dateTime', 'typo']);
  });

  it('shows the links a real send adds, whatever the wording says', () => {
    expect(sampleLinks('booking_confirmed', tokens, TZ, NOW)).toEqual([
      'Change or cancel your booking',
      'Book with Ruiz Photography again',
    ]);
    const pack = sampleLinks('booking_pack_confirmed', tokens, TZ, NOW);
    expect(pack).toHaveLength(4);
    expect(pack[1]).toBe('2. Thursday, October 8 at 10:00 AM — change or cancel');
  });
});

describe('logEmailSend', () => {
  it('files kind and outcome, and trims a long error', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    await logEmailSend({ insert } as unknown as TenantScope, {
      kind: 'booking_cancelled',
      status: 'failed',
      bookingId: 'b1',
      error: 'x'.repeat(900),
    });
    const row = (insert.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(row).toMatchObject({ kind: 'booking_cancelled', status: 'failed', booking_id: 'b1', client_id: null });
    expect((row.error as string).length).toBe(500);
  });

  it('never lets a failed note break the send it is about', async () => {
    const insert = vi.fn(async () => {
      throw new Error('db down');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      logEmailSend({ insert } as unknown as TenantScope, { kind: 'client_invite', status: 'sent' }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
