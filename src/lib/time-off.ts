import { DateTime } from 'luxon';

/**
 * Time off: closing a run of dates at once — a holiday, a bank holiday, a
 * day off. Stored as what one closed day already is (a date override with
 * is_closed), one per date, so the booking page, the Week and the slot
 * engine need to learn nothing new. Pure, so the panel and the route agree.
 */

/** The longest run closed in one go. A season, not a year: a mistyped year
 *  should be a refusal, not four hundred closed days. */
export const TIME_OFF_MAX_DAYS = 120;

/** Every date from `from` to `to`, both included, as yyyy-MM-dd. */
export function datesBetween(from: string, to: string): string[] {
  const start = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  if (!start.isValid || !end.isValid || end < start) return [];
  const out: string[] = [];
  for (let d = start; d <= end && out.length <= TIME_OFF_MAX_DAYS; d = d.plus({ days: 1 })) {
    out.push(d.toISODate()!);
  }
  return out;
}

/** Why this run cannot be closed, or null. */
export function timeOffProblem(from: string, to: string, today: string): string | null {
  const start = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  if (!start.isValid || !end.isValid) return 'Choose the first and last day.';
  if (end < start) return 'The last day is before the first.';
  if (from < today) return 'Time off can’t start in the past.';
  if (end.diff(start, 'days').days + 1 > TIME_OFF_MAX_DAYS) {
    return `That is more than ${TIME_OFF_MAX_DAYS} days. Close it in two parts.`;
  }
  return null;
}

export interface ClosedDay {
  date: string;
  isClosed: boolean;
  note: string | null;
}

export interface ClosedRun {
  from: string;
  to: string;
  days: number;
  /** The first note in the run — the name somebody gave it. */
  note: string | null;
}

/**
 * Closed dates read as runs: 24, 25 and 26 December are one holiday, not
 * three exceptions. Days with their own hours are not time off and are left
 * out; a gap of one open day ends a run.
 */
export function closedRuns(days: readonly ClosedDay[]): ClosedRun[] {
  const closed = days.filter((d) => d.isClosed).sort((a, b) => a.date.localeCompare(b.date));
  const runs: ClosedRun[] = [];
  for (const day of closed) {
    const last = runs[runs.length - 1];
    if (last && DateTime.fromISO(last.to).plus({ days: 1 }).toISODate() === day.date) {
      last.to = day.date;
      last.days += 1;
      last.note ??= day.note;
    } else {
      runs.push({ from: day.date, to: day.date, days: 1, note: day.note });
    }
  }
  return runs;
}

/** "24–26 December", "30 December – 2 January", "Friday 3 October". */
export function runLabel(run: Pick<ClosedRun, 'from' | 'to'>): string {
  const a = DateTime.fromISO(run.from);
  const b = DateTime.fromISO(run.to);
  if (run.from === run.to) return a.toFormat('cccc d LLLL');
  if (a.month === b.month && a.year === b.year) return `${a.day}–${b.toFormat('d LLLL')}`;
  if (a.year === b.year) return `${a.toFormat('d LLLL')} – ${b.toFormat('d LLLL')}`;
  return `${a.toFormat('d LLLL yyyy')} – ${b.toFormat('d LLLL yyyy')}`;
}
