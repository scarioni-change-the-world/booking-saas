import { describe, expect, it } from 'vitest';
import { datesIn, previousPeriod, rangeBounds, rangeLabel, resolvePeriod, unitPeriod } from '../src/lib/report-period';

const today = '2026-09-27';

describe('resolvePeriod', () => {
  it('reads the usual periods, ending today', () => {
    expect(resolvePeriod('7d', today)).toMatchObject({ from: '2026-09-21', to: '2026-09-27', days: 7 });
    expect(resolvePeriod('30d', today)).toMatchObject({ from: '2026-08-29', to: '2026-09-27', days: 30 });
    expect(resolvePeriod('month', today)).toMatchObject({ from: '2026-09-01', to: '2026-09-27', soFar: true });
    expect(resolvePeriod('last-month', today)).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-31',
      days: 31,
    });
    expect(resolvePeriod('year', today)).toMatchObject({ from: '2026-01-01', to: '2026-09-27' });
    expect(resolvePeriod(null, today)).toMatchObject({ preset: '30d' });
  });

  it('takes any two dates, and says plainly what it cannot take', () => {
    expect(resolvePeriod('custom', today, { from: '2026-09-01', to: '2026-09-07' })).toMatchObject({
      preset: 'custom',
      days: 7,
      label: '1–7 September',
    });
    expect(resolvePeriod('custom', today, { from: '2026-09-07', to: '2026-09-01' })).toEqual({
      error: 'The last day is before the first.',
    });
    expect(resolvePeriod('custom', today, { from: '2026-09-01', to: '2026-10-01' })).toMatchObject({
      error: expect.stringMatching(/look back/),
    });
    expect(resolvePeriod('custom', today, { from: '2024-01-01', to: '2026-01-01' })).toMatchObject({
      error: expect.stringMatching(/at most 366/),
    });
    expect(resolvePeriod('custom', today, {})).toMatchObject({ error: expect.stringMatching(/Choose/) });
  });
});

describe('calendar periods', () => {
  // 27 September 2026 is a Sunday.
  it('reads the current week, month, quarter and year so far, with no next one', () => {
    expect(unitPeriod('week', today)).toMatchObject({ from: '2026-09-21', to: '2026-09-27', soFar: true, next: null });
    expect(unitPeriod('month', today)).toMatchObject({ label: 'September', prev: '2026-08-01', next: null });
    expect(unitPeriod('quarter', today)).toMatchObject({ from: '2026-07-01', label: 'July – September' });
    expect(unitPeriod('year', today)).toMatchObject({ from: '2026-01-01', to: '2026-09-27', label: '2026' });
  });

  it('reads any earlier one whole, and steps both ways', () => {
    const feb = unitPeriod('month', today, '2025-02-14');
    expect(feb).toMatchObject({
      from: '2025-02-01',
      to: '2025-02-28',
      soFar: false,
      label: 'February 2025',
      prev: '2025-01-01',
      next: '2025-03-01',
    });
    expect(unitPeriod('quarter', today, '2025-11-30')).toMatchObject({
      from: '2025-10-01',
      to: '2025-12-31',
      label: 'October – December 2025',
    });
    expect(unitPeriod('month', today, '2026-10-01')).toEqual({ error: 'That period has not started yet.' });
  });

  it('compares a running period with the same stretch of the one before', () => {
    const now = unitPeriod('month', '2026-11-13');
    if ('error' in now) throw new Error(now.error);
    expect(previousPeriod(now)).toEqual({ from: '2026-10-01', to: '2026-10-13' });
    // 31 March so far, against February: it cannot run past February's end.
    const march = unitPeriod('month', '2026-03-31');
    if ('error' in march) throw new Error(march.error);
    expect(previousPeriod(march)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('compares a whole period with the whole one before, whatever its length', () => {
    const aug = unitPeriod('month', today, '2026-08-10');
    if ('error' in aug) throw new Error(aug.error);
    expect(previousPeriod(aug)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    const march = unitPeriod('month', today, '2026-03-05');
    if ('error' in march) throw new Error(march.error);
    expect(previousPeriod(march)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('previousPeriod', () => {
  it('is the same length, ending the day before', () => {
    expect(previousPeriod({ from: '2026-09-21', to: '2026-09-27' })).toEqual({
      from: '2026-09-14',
      to: '2026-09-20',
    });
    expect(previousPeriod({ from: '2026-08-01', to: '2026-08-31' })).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });
});

describe('helpers', () => {
  it('lists dates and labels ranges', () => {
    expect(datesIn({ from: '2026-12-30', to: '2027-01-01' })).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect(rangeLabel('2026-08-28', '2026-09-03', today)).toBe('28 August – 3 September');
    expect(rangeLabel('2025-12-28', '2026-01-03', today)).toBe('28 December 2025 – 3 January 2026');
  });

  it('bounds a range in the business’s own zone', () => {
    const { start, end } = rangeBounds({ from: '2026-09-27', to: '2026-09-27' }, 'Europe/Madrid');
    expect(new Date(start).toISOString()).toBe('2026-09-26T22:00:00.000Z');
    expect(end - start).toBe(24 * 3600 * 1000);
  });
});
