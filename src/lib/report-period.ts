import { DateTime } from 'luxon';

/**
 * The period a report covers: one of the usual ones, or any two dates the
 * business chooses — a week, a season, from one date to another. Always
 * compared with the stretch of the same length just before it, because a
 * number alone says nothing; "up a third on the month before" says a lot.
 *
 * Dates are calendar days in the business's own time zone, both ends
 * included. Pure, so the screen and the route agree on every edge.
 */

export type PeriodPreset = '7d' | '30d' | 'month' | 'last-month' | '90d' | 'year' | 'custom';

export const PRESETS: Array<{ id: Exclude<PeriodPreset, 'custom'>; label: string }> = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'year', label: 'This year' },
];

/** A year and a day: long enough for "this year", short enough to answer quickly. */
export const MAX_PERIOD_DAYS = 366;

export interface Period {
  preset: PeriodPreset;
  from: string;
  to: string;
  days: number;
  label: string;
}

export interface DateRange {
  from: string;
  to: string;
}

function days(from: string, to: string): number {
  return Math.round(DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days) + 1;
}

/** "3–9 October", "28 September – 4 October 2026", "1 January – 27 September". */
export function rangeLabel(from: string, to: string, today: string): string {
  const a = DateTime.fromISO(from);
  const b = DateTime.fromISO(to);
  const year = (d: DateTime) => (d.year === DateTime.fromISO(today).year ? '' : ` ${d.year}`);
  if (from === to) return `${a.toFormat('d LLLL')}${year(a)}`;
  if (a.year === b.year && a.month === b.month) return `${a.day}–${b.toFormat('d LLLL')}${year(b)}`;
  if (a.year === b.year) return `${a.toFormat('d LLLL')} – ${b.toFormat('d LLLL')}${year(b)}`;
  return `${a.toFormat('d LLLL yyyy')} – ${b.toFormat('d LLLL yyyy')}`;
}

/**
 * The period asked for, or why it cannot be. A custom period may not end
 * after today — there is nothing to report on yet — nor run backwards, nor
 * be longer than MAX_PERIOD_DAYS.
 */
export function resolvePeriod(
  preset: string | null | undefined,
  today: string,
  custom?: { from?: string | null; to?: string | null },
): Period | { error: string } {
  const t = DateTime.fromISO(today);
  const make = (p: PeriodPreset, from: DateTime, to: DateTime): Period => {
    const f = from.toISODate()!;
    const e = to.toISODate()!;
    const label = PRESETS.find((x) => x.id === p)?.label ?? rangeLabel(f, e, today);
    return { preset: p, from: f, to: e, days: days(f, e), label };
  };

  switch (preset ?? '30d') {
    case '7d':
      return make('7d', t.minus({ days: 6 }), t);
    case '30d':
      return make('30d', t.minus({ days: 29 }), t);
    case '90d':
      return make('90d', t.minus({ days: 89 }), t);
    case 'month':
      return make('month', t.startOf('month'), t);
    case 'last-month': {
      const start = t.minus({ months: 1 }).startOf('month');
      return make('last-month', start, start.endOf('month'));
    }
    case 'year':
      return make('year', t.startOf('year'), t);
    case 'custom': {
      const from = custom?.from ? DateTime.fromISO(custom.from) : null;
      const to = custom?.to ? DateTime.fromISO(custom.to) : null;
      if (!from?.isValid || !to?.isValid) return { error: 'Choose a first and a last day.' };
      if (to < from) return { error: 'The last day is before the first.' };
      if (to > t) return { error: 'A report can only look back — choose a last day up to today.' };
      if (days(from.toISODate()!, to.toISODate()!) > MAX_PERIOD_DAYS) {
        return { error: `Choose at most ${MAX_PERIOD_DAYS} days.` };
      }
      return make('custom', from, to);
    }
    default:
      return make('30d', t.minus({ days: 29 }), t);
  }
}

/** The stretch of the same length that ends the day before this one starts. */
export function previousPeriod(period: DateRange): DateRange {
  const length = days(period.from, period.to);
  const to = DateTime.fromISO(period.from).minus({ days: 1 });
  return { from: to.minus({ days: length - 1 }).toISODate()!, to: to.toISODate()! };
}

/** Every date in a range, for adding up open hours. */
export function datesIn(range: DateRange): string[] {
  const out: string[] = [];
  const end = DateTime.fromISO(range.to);
  for (let d = DateTime.fromISO(range.from); d <= end; d = d.plus({ days: 1 })) out.push(d.toISODate()!);
  return out;
}

/** The instants a range covers in a zone: [start, end). */
export function rangeBounds(range: DateRange, timezone: string): { start: number; end: number } {
  return {
    start: DateTime.fromISO(range.from, { zone: timezone }).startOf('day').toMillis(),
    end: DateTime.fromISO(range.to, { zone: timezone }).plus({ days: 1 }).startOf('day').toMillis(),
  };
}
