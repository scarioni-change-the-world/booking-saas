import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { generateSlots, limitToServiceHours } from '../src/lib/availability';
import { parseServiceHours, serviceHoursSummary } from '../src/lib/service-hours';

describe('limitToServiceHours', () => {
  const open = [{ startTime: '09:00:00', endTime: '17:00:00' }];

  it('keeps the opening hours when the service has no limit', () => {
    expect(limitToServiceHours(open, 1, null)).toEqual(open);
    expect(limitToServiceHours(open, 1, [])).toEqual(open);
  });

  it('narrows to the overlap, never widens, and closes other days', () => {
    const only = [{ weekday: 1, startTime: '08:00', endTime: '12:00' }];
    expect(limitToServiceHours(open, 1, only)).toEqual([{ startTime: '09:00', endTime: '12:00' }]);
    expect(limitToServiceHours(open, 2, only)).toEqual([]);
    expect(limitToServiceHours(open, 1, [{ weekday: 1, startTime: '18:00', endTime: '20:00' }])).toEqual([]);
  });
});

describe('slots for a service with its own hours', () => {
  it('offers only Monday mornings inside Monday-to-Friday opening hours', () => {
    const days = generateSlots({
      timezone: 'Europe/Madrid',
      fromDate: '2026-11-23',
      toDate: '2026-11-24',
      eventType: { durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
      availabilityRules: [1, 2].map((weekday) => ({ weekday, startTime: '09:00', endTime: '17:00' })),
      dateOverrides: [],
      serviceHours: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
      busy: [],
      noticeHours: 0,
      bookingWindowDays: 0,
      now: DateTime.fromISO('2026-11-18T12:00:00Z'),
    });
    expect(days.map((d) => d.date)).toEqual(['2026-11-23']);
    expect(days[0]!.slots).toHaveLength(3);
  });
});

describe('parseServiceHours', () => {
  it('accepts days with one time range, or none for whenever open', () => {
    expect(parseServiceHours(null)).toBeNull();
    expect(parseServiceHours([])).toBeNull();
    expect(parseServiceHours([{ weekday: 3, startTime: '10:00', endTime: '14:30' }])).toEqual([
      { weekday: 3, startTime: '10:00', endTime: '14:30' },
    ]);
  });

  it('refuses what cannot be a time', () => {
    expect(() => parseServiceHours([{ weekday: 8, startTime: '10:00', endTime: '11:00' }])).toThrow();
    expect(() => parseServiceHours([{ weekday: 1, startTime: '12:00', endTime: '11:00' }])).toThrow();
    expect(() => parseServiceHours([{ weekday: 1, startTime: '9am', endTime: '11:00' }])).toThrow();
    expect(() => parseServiceHours('mondays')).toThrow();
  });

  it('says it in a line', () => {
    expect(serviceHoursSummary(null)).toBe('Whenever you are open');
    expect(
      serviceHoursSummary([1, 3].map((weekday) => ({ weekday, startTime: '10:00', endTime: '14:00' }))),
    ).toBe('Mon, Wed · 10:00–14:00');
  });
});
