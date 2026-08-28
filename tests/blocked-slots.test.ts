import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  dayBoundsUtc,
  minutesIntoDay,
  minutesToTimeLabel,
  parseTimeToMinutes,
} from '@/lib/blocked-slots';

const MADRID = 'Europe/Madrid';

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
