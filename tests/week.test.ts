import { describe, expect, it } from 'vitest';
import {
  cellsToWindows,
  coveredMinutes,
  mondayOf,
  placeBooking,
  rulesToCells,
  shiftWeek,
  visibleRange,
  weekDates,
  wouldShift,
  type WeeklyRule,
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

describe('painting usual hours', () => {
  const nineToFive: WeeklyRule[] = [{ weekday: 2, startTime: '09:00', endTime: '17:00' }];

  it('turns a rule into the cells it covers', () => {
    const cells = rulesToCells(nineToFive, 2, range);
    expect(cells).toHaveLength(20); // 08:00 to 18:00 in halves
    expect(cells.filter(Boolean)).toHaveLength(16);
    expect(cells[0]).toBe(false); // 08:00
    expect(cells[2]).toBe(true); // 09:00
    expect(cells[17]).toBe(true); // 16:30
    expect(cells[18]).toBe(false); // 17:00
  });

  it('leaves other weekdays alone', () => {
    expect(rulesToCells(nineToFive, 3, range).some(Boolean)).toBe(false);
  });

  it('never widens a rule that starts off the half hour', () => {
    /* 09:15 must not become 09:00: that would offer clients a quarter of an
       hour the business never said they were free. */
    const cells = rulesToCells([{ weekday: 1, startTime: '09:15', endTime: '12:00' }], 1, range);
    expect(cells[2]).toBe(false); // 09:00–09:30 only partly covered
    expect(cells[3]).toBe(true); // 09:30
  });

  it('round-trips a split day into the same two rules', () => {
    const split: WeeklyRule[] = [
      { weekday: 4, startTime: '09:00', endTime: '13:00' },
      { weekday: 4, startTime: '15:00', endTime: '17:30' },
    ];
    expect(cellsToWindows(rulesToCells(split, 4, range), range)).toEqual([
      { startTime: '09:00', endTime: '13:00' },
      { startTime: '15:00', endTime: '17:30' },
    ]);
  });

  it('merges painted neighbours into one window', () => {
    const cells = Array(20).fill(false);
    cells[2] = cells[3] = cells[4] = true;
    expect(cellsToWindows(cells, range)).toEqual([{ startTime: '09:00', endTime: '10:30' }]);
  });

  it('closes a run that reaches the bottom of the grid', () => {
    const cells = Array(20).fill(false);
    cells[18] = cells[19] = true;
    expect(cellsToWindows(cells, range)).toEqual([{ startTime: '17:00', endTime: '18:00' }]);
  });

  it('stores a window that reaches midnight as 23:59, which the database accepts', () => {
    const late = { startMinutes: 22 * 60, endMinutes: 24 * 60 };
    expect(cellsToWindows([false, true, true, true], late)).toEqual([
      { startTime: '22:30', endTime: '23:59' },
    ]);
  });

  it('saves an empty day as no windows at all', () => {
    expect(cellsToWindows(Array(20).fill(false), range)).toEqual([]);
  });
});

describe('wouldShift', () => {
  it('is quiet about hours already on the half hour', () => {
    expect(wouldShift([{ weekday: 1, startTime: '09:00', endTime: '17:30' }], 1, range)).toBe(false);
  });

  it('warns about a start off the half hour', () => {
    expect(wouldShift([{ weekday: 1, startTime: '08:45', endTime: '17:00' }], 1, range)).toBe(true);
  });

  it('warns about hours outside what the grid shows', () => {
    expect(wouldShift([{ weekday: 1, startTime: '07:00', endTime: '12:00' }], 1, range)).toBe(true);
  });

  it('only looks at the weekday asked about', () => {
    expect(wouldShift([{ weekday: 2, startTime: '08:45', endTime: '17:00' }], 1, range)).toBe(false);
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
