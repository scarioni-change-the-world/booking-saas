import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  carveRange,
  dayBoundsUtc,
  minutesIntoDay,
  minutesToTimeLabel,
  parseTimeToMinutes,
  type BlockedInterval,
} from '@/lib/blocked-slots';

const MADRID = 'Europe/Madrid';

/** A blocked interval on 2027-06-15 Madrid, given as plain "HH:mm" bounds —
 * carveRange tests read far more clearly in wall-clock terms than in raw
 * instants. */
function interval(id: string, start: string, end: string, reason: string | null = null): BlockedInterval {
  return {
    id,
    startsAt: DateTime.fromISO(`2027-06-15T${start}`, { zone: MADRID }),
    endsAt: DateTime.fromISO(`2027-06-15T${end}`, { zone: MADRID }),
    reason,
  };
}

function at(time: string): DateTime {
  return DateTime.fromISO(`2027-06-15T${time}`, { zone: MADRID });
}

describe('parseTimeToMinutes', () => {
  it('parses "HH:mm"', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });

  it('parses "HH:mm:ss", ignoring seconds', () => {
    expect(parseTimeToMinutes('14:15:00')).toBe(855);
  });
});

describe('minutesToTimeLabel', () => {
  it('round-trips a normal time', () => {
    expect(minutesToTimeLabel(570)).toBe('09:30');
    expect(minutesToTimeLabel(0)).toBe('00:00');
  });

  it('clamps out-of-range minutes rather than producing an invalid label', () => {
    expect(minutesToTimeLabel(1440)).toBe('23:59'); // a block that runs to next-day midnight
    expect(minutesToTimeLabel(-5)).toBe('00:00'); // a block that started before this day
  });
});

describe('dayBoundsUtc', () => {
  it('spans exactly 24 real hours on an ordinary day', () => {
    const bounds = dayBoundsUtc('2027-06-15', MADRID);
    expect(bounds).not.toBeNull();
    expect(bounds!.end.diff(bounds!.start, 'hours').hours).toBe(24);
    // CEST that week is UTC+2, so local midnight is 22:00 UTC the day before.
    expect(bounds!.start.toUTC().toISO()).toBe('2027-06-14T22:00:00.000Z');
  });

  it('spans only 23 real hours on the spring-forward date (brief 5 / DST)', () => {
    // Same transition date the slot engine's own tests use: 2027-03-28,
    // 02:00 -> 03:00 local in Madrid.
    const bounds = dayBoundsUtc('2027-03-28', MADRID);
    expect(bounds).not.toBeNull();
    expect(bounds!.end.diff(bounds!.start, 'hours').hours).toBe(23);
  });

  it('returns null for a malformed date', () => {
    expect(dayBoundsUtc('not-a-date', MADRID)).toBeNull();
  });
});

describe('minutesIntoDay', () => {
  it('reads wall-clock time, not elapsed real time, across the spring-forward day', () => {
    const bounds = dayBoundsUtc('2027-03-28', MADRID)!;
    // 09:00 local, after the 02:00->03:00 jump. Only 8 real hours (480
    // minutes) have elapsed since local midnight, but this must still read
    // as 09:00 -> 540: the grid's cells are labelled by wall-clock time.
    const nineLocal = DateTime.fromISO('2027-03-28T09:00:00', { zone: MADRID });
    expect(minutesIntoDay(nineLocal, bounds)).toBe(540);
  });

  it('clamps an instant before the day to 0', () => {
    const bounds = dayBoundsUtc('2027-06-15', MADRID)!;
    const before = bounds.start.minus({ hours: 2 });
    expect(minutesIntoDay(before, bounds)).toBe(0);
  });

  it('clamps an instant at or after the next day to 1440', () => {
    const bounds = dayBoundsUtc('2027-06-15', MADRID)!;
    expect(minutesIntoDay(bounds.end, bounds)).toBe(1440);
    expect(minutesIntoDay(bounds.end.plus({ hours: 3 }), bounds)).toBe(1440);
  });
});

describe('carveRange', () => {
  it('deletes a block the range covers entirely', () => {
    const plan = carveRange([interval('a', '11:30', '12:00')], at('11:00'), at('13:00'));
    expect(plan.toDelete).toEqual(['a']);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toInsert).toEqual([]);
  });

  it('deletes a block exactly matching the range (the common single-drag case)', () => {
    const plan = carveRange([interval('a', '11:00', '13:00')], at('11:00'), at('13:00'));
    expect(plan.toDelete).toEqual(['a']);
  });

  it('splits a block in two when the range is a hole in the middle', () => {
    // The bug this exists to fix: clicking one 30-minute cell in the middle
    // of a longer drag-created block must not remove the whole block.
    const plan = carveRange([interval('a', '09:00', '13:00', 'Dentist')], at('11:00'), at('11:30'));
    expect(plan.toDelete).toEqual([]);
    expect(plan.toUpdate).toEqual([
      { id: 'a', startsAt: at('09:00'), endsAt: at('11:00') },
    ]);
    expect(plan.toInsert).toEqual([
      { startsAt: at('11:30'), endsAt: at('13:00'), reason: 'Dentist' },
    ]);
  });

  it('shrinks a block from the tail when the range overlaps only its end', () => {
    const plan = carveRange([interval('a', '09:00', '11:00')], at('10:00'), at('12:00'));
    expect(plan.toDelete).toEqual([]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toUpdate).toEqual([{ id: 'a', startsAt: at('09:00'), endsAt: at('10:00') }]);
  });

  it('shrinks a block from the front when the range overlaps only its start', () => {
    const plan = carveRange([interval('a', '10:00', '12:00')], at('09:00'), at('11:00'));
    expect(plan.toDelete).toEqual([]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toUpdate).toEqual([{ id: 'a', startsAt: at('11:00'), endsAt: at('12:00') }]);
  });

  it('resolves several affected blocks in one call, each on its own terms', () => {
    const plan = carveRange(
      [
        interval('gone', '10:15', '10:45'), // fully inside the range -> deleted
        interval('shrunk-tail', '09:00', '10:30'), // -> ends at 10:15
        interval('shrunk-front', '10:30', '12:00'), // -> starts at 11:00
      ],
      at('10:15'),
      at('11:00'),
    );
    expect(plan.toDelete).toEqual(['gone']);
    expect(plan.toUpdate).toEqual([
      { id: 'shrunk-tail', startsAt: at('09:00'), endsAt: at('10:15') },
      { id: 'shrunk-front', startsAt: at('11:00'), endsAt: at('12:00') },
    ]);
    expect(plan.toInsert).toEqual([]);
  });

  it('does nothing given no overlapping intervals', () => {
    expect(carveRange([], at('10:00'), at('11:00'))).toEqual({
      toDelete: [],
      toUpdate: [],
      toInsert: [],
    });
  });
});
