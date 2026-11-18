import { describe, expect, it } from 'vitest';
import {
  coveredMinutes,
  mondayOf,
  placeBooking,
  shiftWeek,
  visibleRange,
  weekDates,
} from '@/lib/week';

const range = { startMinutes: 8 * 60, endMinutes: 18 * 60 };

describe('the week itself', () => {
  it('starts on Monday whichever day it is asked about', () => {
    expect(mondayOf('2026-10-01')).toBe('2026-09-28'); // a Thursday
    expect(mondayOf('2026-09-28')).toBe('2026-09-28'); // already Monday
    expect(mondayOf('2026-10-04')).toBe('2026-09-28'); // Sunday belongs to the week before it
  });

  it('lists seven dates across a month boundary', () => {
    expect(weekDates('2026-09-28')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
  });

  it('moves whole weeks', () => {
    expect(shiftWeek('2026-09-28', 1)).toBe('2026-10-05');
    expect(shiftWeek('2026-09-28', -1)).toBe('2026-09-21');
  });
});

describe('visibleRange', () => {
  it('shows a working day even when nothing is set', () => {
    expect(visibleRange([])).toEqual(range);
  });

  it('stretches to whole hours around an early booking', () => {
    expect(visibleRange([{ startMinutes: 7 * 60 + 30, endMinutes: 8 * 60 + 20 }]).startMinutes).toBe(7 * 60);
  });

  it('stretches to whole hours around a late one', () => {
    expect(visibleRange([{ startMinutes: 19 * 60, endMinutes: 20 * 60 + 15 }]).endMinutes).toBe(21 * 60);
  });
});

describe('placeBooking', () => {
  it('uses the business time zone, not the viewer’s', () => {
    // 08:00 UTC in late September is 10:00 in Madrid (CEST).
    expect(placeBooking('2026-09-29T08:00:00Z', '2026-09-29T09:00:00Z', 'Europe/Madrid')).toEqual({
      date: '2026-09-29',
      startMinutes: 10 * 60,
      endMinutes: 11 * 60,
    });
  });

  it('files a booking under the business’s date when UTC is already the next day', () => {
    // 03:00 UTC on the 30th is 20:00 on the 29th in Los Angeles.
    expect(placeBooking('2026-09-30T03:00:00Z', '2026-09-30T04:00:00Z', 'America/Los_Angeles').date).toBe(
      '2026-09-29',
    );
  });

  it('draws an appointment that runs past midnight to the bottom of its day', () => {
    const p = placeBooking('2026-09-29T21:30:00Z', '2026-09-29T22:30:00Z', 'Europe/Madrid');
    expect(p).toEqual({ date: '2026-09-29', startMinutes: 23 * 60 + 30, endMinutes: 24 * 60 });
  });
});

describe('coveredMinutes', () => {
  it('counts overlapping windows once', () => {
    expect(
      coveredMinutes([
        { startMinutes: 540, endMinutes: 780 },
        { startMinutes: 720, endMinutes: 1020 },
      ]),
    ).toBe(480);
  });

  it('ignores empty and backwards windows', () => {
    expect(coveredMinutes([{ startMinutes: 600, endMinutes: 600 }, { startMinutes: 700, endMinutes: 650 }])).toBe(0);
  });
});
