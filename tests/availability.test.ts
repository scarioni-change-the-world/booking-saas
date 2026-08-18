import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  generateSlots,
  isSlotBookable,
  type SlotQuery,
} from '@/lib/availability';

const MADRID = 'Europe/Madrid';

/** Weekday-agnostic base query: open 09:00–17:00 every day, 60-minute sessions. */
function baseQuery(overrides: Partial<SlotQuery> = {}): SlotQuery {
  return {
    timezone: MADRID,
    fromDate: '2026-09-07',
    toDate: '2026-09-07',
    eventType: { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
    availabilityRules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      startTime: '09:00',
      endTime: '17:00',
    })),
    dateOverrides: [],
    busy: [],
    noticeHours: 0,
    bookingWindowDays: 0,
    now: DateTime.fromISO('2026-09-01T00:00:00', { zone: MADRID }),
    ...overrides,
  };
}

/** Slot instants rendered back as tenant-local 'HH:mm', which is what a client sees. */
function localTimes(query: SlotQuery, date = '2026-09-07'): string[] {
  const day = generateSlots(query).find((d) => d.date === date);
  return (day?.slots ?? []).map((iso) =>
    DateTime.fromISO(iso, { zone: 'utc' }).setZone(query.timezone).toFormat('HH:mm'),
  );
}

describe('slot generation — the two rules that were got wrong (brief 5)', () => {
  it('steps by the session duration, not a fixed grid', () => {
    // 60-minute sessions in a 09:00-17:00 window start only on the hour.
    expect(localTimes(baseQuery())).toEqual([
      '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00',
    ]);
  });

  it('steps by duration for non-hour durations too', () => {
    const q = baseQuery({
      eventType: { durationMinutes: 45, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
    });
    // 09:00, 09:45, 10:30 ... never a 15-minute global grid.
    expect(localTimes(q).slice(0, 4)).toEqual(['09:00', '09:45', '10:30', '11:15']);
  });

  it('does not let buffers shift the displayed start time', () => {
    // The regression that produced start times like 2:20 PM.
    const q = baseQuery({
      eventType: { durationMinutes: 60, bufferBeforeMinutes: 20, bufferAfterMinutes: 20 },
    });
    for (const time of localTimes(q)) {
      expect(time.endsWith(':00')).toBe(true);
    }
  });

  it('widens only the conflict check with buffers', () => {
    // A busy block 11:00-11:30 must knock out the 10:00 slot as well, because a
    // 60-minute session at 10:00 with a 20-minute after-buffer runs to 11:20.
    const q = baseQuery({
      eventType: { durationMinutes: 60, bufferBeforeMinutes: 20, bufferAfterMinutes: 20 },
      busy: [{ start: '2026-09-07T09:00:00Z', end: '2026-09-07T09:30:00Z' }], // 11:00-11:30 local
    });
    const times = localTimes(q);
    expect(times).not.toContain('10:00');
    expect(times).not.toContain('11:00');
    expect(times).toContain('09:00');
    expect(times).toContain('12:00');
  });

  it('reserves the before-buffer against an earlier commitment', () => {
    // Busy 08:45-09:00 local. A 09:00 start needs the preceding 20 minutes free.
    const q = baseQuery({
      eventType: { durationMinutes: 60, bufferBeforeMinutes: 20, bufferAfterMinutes: 0 },
      busy: [{ start: '2026-09-07T06:45:00Z', end: '2026-09-07T07:00:00Z' }],
    });
    expect(localTimes(q)).not.toContain('09:00');
    expect(localTimes(q)).toContain('10:00');
  });

  it('requires the after-buffer to fit inside the window', () => {
    const withBuffer = baseQuery({
      eventType: { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 30 },
    });
    // 16:00 would end at 17:00 but its buffer runs to 17:30, past the window.
    expect(localTimes(withBuffer)).not.toContain('16:00');
    expect(localTimes(withBuffer)).toContain('15:00');
  });
});

describe('busy intervals', () => {
  it('treats a booking, an ad-hoc block and calendar busy identically', () => {
    const q = baseQuery({
      busy: [
        { start: '2026-09-07T07:00:00Z', end: '2026-09-07T08:00:00Z' }, // 09:00 booking
        { start: '2026-09-07T09:00:00Z', end: '2026-09-07T10:00:00Z' }, // 11:00 block
        { start: '2026-09-07T11:00:00Z', end: '2026-09-07T12:00:00Z' }, // 13:00 calendar
      ],
    });
    expect(localTimes(q)).toEqual(['10:00', '12:00', '14:00', '15:00', '16:00']);
  });

  it('merges overlapping busy intervals without losing coverage', () => {
    const q = baseQuery({
      busy: [
        { start: '2026-09-07T07:00:00Z', end: '2026-09-07T09:00:00Z' },
        { start: '2026-09-07T08:00:00Z', end: '2026-09-07T10:00:00Z' },
      ],
    });
    const times = localTimes(q);
    for (const blocked of ['09:00', '10:00', '11:00']) {
      expect(times).not.toContain(blocked);
    }
    expect(times).toContain('12:00');
  });

  it('allows a slot that merely abuts a busy interval', () => {
    // Busy 09:00-10:00 local; a 10:00 start touches but does not overlap.
    const q = baseQuery({
      busy: [{ start: '2026-09-07T07:00:00Z', end: '2026-09-07T08:00:00Z' }],
    });
    expect(localTimes(q)).toContain('10:00');
  });
});

describe('notice hours and booking window', () => {
  it('suppresses slots inside the notice period', () => {
    const q = baseQuery({
      now: DateTime.fromISO('2026-09-07T08:00:00', { zone: MADRID }),
      noticeHours: 24,
      fromDate: '2026-09-07',
      toDate: '2026-09-08',
    });
    expect(generateSlots(q).find((d) => d.date === '2026-09-07')).toBeUndefined();
    // 24h later is 08:00 on the 8th, so the whole of the 8th survives.
    expect(localTimes(q, '2026-09-08')).toContain('09:00');
  });

  it('applies notice within a day, not just whole days', () => {
    const q = baseQuery({
      now: DateTime.fromISO('2026-09-07T09:30:00', { zone: MADRID }),
      noticeHours: 2,
    });
    const times = localTimes(q);
    expect(times).not.toContain('11:00'); // 11:00 is inside the 2h notice
    expect(times).toContain('12:00');
  });

  it('treats bookingWindowDays = 0 as unlimited', () => {
    const q = baseQuery({
      bookingWindowDays: 0,
      fromDate: '2028-01-10',
      toDate: '2028-01-10',
    });
    expect(localTimes(q, '2028-01-10').length).toBe(8);
  });

  it('closes the window at the end of the last permitted day', () => {
    const q = baseQuery({
      now: DateTime.fromISO('2026-09-07T12:00:00', { zone: MADRID }),
      bookingWindowDays: 1,
      fromDate: '2026-09-08',
      toDate: '2026-09-09',
    });
    // All of the 8th is inside a one-day window, despite "now" being midday.
    expect(localTimes(q, '2026-09-08')).toContain('16:00');
    expect(generateSlots(q).find((d) => d.date === '2026-09-09')).toBeUndefined();
  });
});

describe('availability rules and overrides', () => {
  it('only opens on configured weekdays', () => {
    // 2026-09-07 is a Monday; 2026-09-08 a Tuesday.
    const q = baseQuery({
      availabilityRules: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }],
      fromDate: '2026-09-07',
      toDate: '2026-09-08',
    });
    const days = generateSlots(q).map((d) => d.date);
    expect(days).toEqual(['2026-09-07']);
  });

  it('supports split shifts on one weekday', () => {
    const q = baseQuery({
      availabilityRules: [
        { weekday: 1, startTime: '09:00', endTime: '11:00' },
        { weekday: 1, startTime: '15:00', endTime: '17:00' },
      ],
    });
    expect(localTimes(q)).toEqual(['09:00', '10:00', '15:00', '16:00']);
  });

  it('never emits a duplicate instant from overlapping rules', () => {
    const q = baseQuery({
      availabilityRules: [
        { weekday: 1, startTime: '09:00', endTime: '13:00' },
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
      ],
    });
    const times = localTimes(q);
    expect(times).toEqual([...new Set(times)]);
    expect(times).toEqual(['09:00', '10:00', '11:00', '12:00']);
  });

  it('closes a day outright for a holiday override', () => {
    const q = baseQuery({
      dateOverrides: [{ date: '2026-09-07', isClosed: true }],
    });
    expect(generateSlots(q)).toEqual([]);
  });

  it('replaces the weekly hours with special hours, not adds to them', () => {
    const q = baseQuery({
      dateOverrides: [
        { date: '2026-09-07', isClosed: false, startTime: '18:00', endTime: '21:00' },
      ],
    });
    // The usual 09:00-17:00 must be gone entirely.
    expect(localTimes(q)).toEqual(['18:00', '19:00', '20:00']);
  });
});

describe('DST transitions (Europe/Madrid)', () => {
  it('keeps wall-clock start times across a spring-forward day', () => {
    // 2027-03-28: 02:00 -> 03:00 local. The working day is unaffected and the
    // client must still see whole hours from 09:00.
    const q = baseQuery({
      fromDate: '2027-03-28',
      toDate: '2027-03-28',
      now: DateTime.fromISO('2027-03-01T00:00:00', { zone: MADRID }),
    });
    expect(localTimes(q, '2027-03-28')).toEqual([
      '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00',
    ]);
  });

  it('does not invent a slot in the hour skipped by spring-forward', () => {
    // A window opening at 02:00 on the transition date does not exist locally.
    const q = baseQuery({
      fromDate: '2027-03-28',
      toDate: '2027-03-28',
      availabilityRules: [{ weekday: 7, startTime: '02:00', endTime: '02:59' }],
      now: DateTime.fromISO('2027-03-01T00:00:00', { zone: MADRID }),
    });
    expect(generateSlots(q)).toEqual([]);
  });

  it('produces the right number of slots across an autumn fall-back day', () => {
    // 2026-10-25: 03:00 -> 02:00 local, so the local day is 25 hours long. A
    // window stated in wall-clock terms still yields wall-clock start times.
    const q = baseQuery({
      fromDate: '2026-10-25',
      toDate: '2026-10-25',
      availabilityRules: [{ weekday: 7, startTime: '09:00', endTime: '17:00' }],
      now: DateTime.fromISO('2026-10-01T00:00:00', { zone: MADRID }),
    });
    expect(localTimes(q, '2026-10-25')).toEqual([
      '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00',
    ]);
  });

  it('steps by real elapsed minutes through the repeated hour', () => {
    // 01:00-04:00 wall clock on fall-back night spans 4 real hours, so a
    // 60-minute session fits four times, and 02:00 appears twice — at two
    // genuinely different instants, an hour apart.
    const q = baseQuery({
      fromDate: '2026-10-25',
      toDate: '2026-10-25',
      availabilityRules: [{ weekday: 7, startTime: '01:00', endTime: '04:00' }],
      now: DateTime.fromISO('2026-10-01T00:00:00', { zone: MADRID }),
    });
    const day = generateSlots(q).find((d) => d.date === '2026-10-25');
    expect(day?.slots).toHaveLength(4);

    const instants = (day?.slots ?? []).map((s) => DateTime.fromISO(s).toMillis());
    for (let i = 1; i < instants.length; i += 1) {
      expect(instants[i]! - instants[i - 1]!).toBe(60 * 60 * 1000);
    }
  });
});

describe('range handling', () => {
  it('spans a month boundary', () => {
    const q = baseQuery({ fromDate: '2026-09-29', toDate: '2026-10-02' });
    expect(generateSlots(q).map((d) => d.date)).toEqual([
      '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
    ]);
  });

  it('spans a year boundary', () => {
    const q = baseQuery({
      fromDate: '2026-12-31',
      toDate: '2027-01-01',
      now: DateTime.fromISO('2026-12-01T00:00:00', { zone: MADRID }),
    });
    expect(generateSlots(q).map((d) => d.date)).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('omits days with no slots rather than returning empty entries', () => {
    const q = baseQuery({
      fromDate: '2026-09-07',
      toDate: '2026-09-09',
      dateOverrides: [{ date: '2026-09-08', isClosed: true }],
    });
    expect(generateSlots(q).map((d) => d.date)).toEqual(['2026-09-07', '2026-09-09']);
  });

  it('returns nothing when the range is inverted', () => {
    expect(generateSlots(baseQuery({ fromDate: '2026-09-09', toDate: '2026-09-07' }))).toEqual([]);
  });

  it('rejects an unknown timezone rather than guessing', () => {
    expect(() => generateSlots(baseQuery({ timezone: 'Mars/Olympus' }))).toThrow();
  });
});

describe('isSlotBookable — the write-path guard', () => {
  it('accepts an instant the generator offered', () => {
    const q = baseQuery();
    const first = generateSlots(q)[0]!.slots[0]!;
    expect(isSlotBookable(q, first)).toBe(true);
  });

  it('rejects an off-grid instant a caller invented', () => {
    // 09:30 was never offered — 60-minute sessions start on the hour.
    expect(isSlotBookable(baseQuery(), '2026-09-07T07:30:00.000Z')).toBe(false);
  });

  it('rejects an instant that has since become busy', () => {
    const q = baseQuery({
      busy: [{ start: '2026-09-07T07:00:00Z', end: '2026-09-07T08:00:00Z' }],
    });
    expect(isSlotBookable(q, '2026-09-07T07:00:00.000Z')).toBe(false);
  });

  it('rejects an instant inside the notice period', () => {
    const q = baseQuery({
      now: DateTime.fromISO('2026-09-07T08:00:00', { zone: MADRID }),
      noticeHours: 24,
    });
    expect(isSlotBookable(q, '2026-09-07T08:00:00.000Z')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isSlotBookable(baseQuery(), 'not-a-date')).toBe(false);
  });
});
