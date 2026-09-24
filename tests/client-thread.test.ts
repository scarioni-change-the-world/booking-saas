import { describe, expect, it } from 'vitest';
import { clientThread, programmeThread, sessionName, type HistoryBooking } from '@/lib/client-thread';

const NOW = '2026-09-29T12:00:00Z';
const appt = (day: string, status: 'confirmed' | 'cancelled' = 'confirmed') => ({
  startsAt: `2026-${day}T08:00:00Z`,
  endsAt: `2026-${day}T09:00:00Z`,
  status,
});

describe('programmeThread', () => {
  it('marks what is done, what is next, and what is booked after that', () => {
    const steps = programmeThread([appt('09-28'), appt('09-30'), appt('10-02')], 0, NOW);
    expect(steps.map((s) => s.tone)).toEqual(['done', 'next', 'booked']);
    expect(steps.map((s) => s.position)).toEqual([1, 2, 3]);
  });

  it('draws a cancelled session as a gap to book, saying when the cancelled one was', () => {
    const steps = programmeThread([appt('09-28'), appt('09-30'), appt('10-02', 'cancelled')], 1, NOW);
    expect(steps).toEqual([
      { tone: 'done', startsAt: '2026-09-28T08:00:00Z', position: 1 },
      { tone: 'next', startsAt: '2026-09-30T08:00:00Z', position: 2 },
      { tone: 'owed', position: 3, cancelledStartsAt: '2026-10-02T08:00:00Z' },
    ]);
  });

  it('leaves no trace of a cancellation already booked again', () => {
    const steps = programmeThread([appt('09-10', 'cancelled'), appt('09-28'), appt('09-30'), appt('10-02')], 0, NOW);
    expect(steps.map((s) => s.tone)).toEqual(['done', 'next', 'booked']);
  });

  it('adds a plain spot for each session the business added on top', () => {
    const steps = programmeThread([appt('09-28')], 2, NOW);
    expect(steps.slice(1)).toEqual([
      { tone: 'owed', position: 2, cancelledStartsAt: undefined },
      { tone: 'owed', position: 3, cancelledStartsAt: undefined },
    ]);
  });
});

describe('sessionName', () => {
  it('names sessions in words, then by number', () => {
    expect(sessionName(3)).toBe('Third session');
    expect(sessionName(12)).toBe('Session 12');
  });
});

describe('clientThread', () => {
  const b = (over: Partial<HistoryBooking>): HistoryBooking => ({
    startsAt: '2026-03-10T09:00:00Z',
    endsAt: '2026-03-10T10:00:00Z',
    status: 'confirmed',
    eventTypeName: 'Portrait session',
    packId: null,
    packSize: null,
    manageToken: null,
    ...over,
  });

  it('draws a programme as one step with how far along it is', () => {
    const steps = clientThread(
      [
        b({ packId: 'p', packSize: 3, startsAt: '2026-09-28T08:00:00Z', endsAt: '2026-09-28T09:00:00Z', eventTypeName: 'Portrait programme' }),
        b({ packId: 'p', packSize: 3, startsAt: '2026-09-30T08:00:00Z', endsAt: '2026-09-30T09:00:00Z', eventTypeName: 'Portrait programme', manageToken: 'm2' }),
      ],
      [],
      NOW,
    );
    expect(steps).toEqual([
      {
        kind: 'programme',
        tone: 'next',
        eventTypeName: 'Portrait programme',
        size: 3,
        done: 1,
        next: { startsAt: '2026-09-30T08:00:00Z', manageToken: 'm2' },
        startsAt: '2026-09-28T08:00:00Z',
      },
    ]);
  });

  it('keeps history in order, leaves out cancelled single appointments, and ends on what is owed', () => {
    const steps = clientThread(
      [
        b({}),
        b({ startsAt: '2026-06-01T09:00:00Z', endsAt: '2026-06-01T10:00:00Z', status: 'cancelled' }),
        b({ startsAt: '2026-10-05T09:00:00Z', endsAt: '2026-10-05T10:00:00Z', manageToken: 'm9' }),
      ],
      [{ entitlementId: 'e', eventTypeName: 'Portrait programme', remaining: 1, totalSessions: 3 }],
      NOW,
    );
    expect(steps.map((s) => `${s.kind}:${s.tone}`)).toEqual(['single:done', 'single:next', 'owed:owed']);
  });

  it('marks only the soonest thing to come as next', () => {
    const steps = clientThread(
      [
        b({ startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T10:00:00Z' }),
        b({ startsAt: '2026-10-05T09:00:00Z', endsAt: '2026-10-05T10:00:00Z' }),
      ],
      [],
      NOW,
    );
    expect(steps.map((s) => s.tone)).toEqual(['next', 'booked']);
  });

  it('draws nothing for a balance that is spent', () => {
    expect(
      clientThread([], [{ entitlementId: 'e', eventTypeName: 'X', remaining: 0, totalSessions: 3 }], NOW),
    ).toEqual([]);
  });
});
