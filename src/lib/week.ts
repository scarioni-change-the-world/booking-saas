import { DateTime } from 'luxon';

/**
 * The arithmetic behind the Week screen: one picture of a business's hours,
 * its one-off exceptions, the stretches it has blocked, and the bookings
 * sitting on top of all three.
 *
 * Pure and client-safe — Luxon and the minute helpers only — so the grid
 * and its tests share one definition of what a week is.
 *
 * Everything is in the BUSINESS's time zone, never the viewer's. A coach
 * in Madrid checking her week from a hotel in New York is looking at her
 * Madrid diary; showing it in New York time would move every appointment
 * six hours and make her own hours unrecognisable.
 */

/** The day panel's half-hour steps: the same half hour the booking page offers slots on. */
export const CELL_MINUTES = 30;

export interface Window {
  startMinutes: number;
  endMinutes: number;
}

/** The Monday of the week containing `dateIso`. */
export function mondayOf(dateIso: string): string {
  const date = DateTime.fromISO(dateIso);
  return date.minus({ days: date.weekday - 1 }).toFormat('yyyy-MM-dd');
}

/** The seven dates of the week starting on `mondayIso`. */
export function weekDates(mondayIso: string): string[] {
  const start = DateTime.fromISO(mondayIso);
  return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).toFormat('yyyy-MM-dd'));
}

export function shiftWeek(mondayIso: string, weeks: number): string {
  return DateTime.fromISO(mondayIso).plus({ weeks }).toFormat('yyyy-MM-dd');
}

/**
 * Which hours the grid should show.
 *
 * Wide enough for a normal working day even when nothing is set — an empty
 * 09:00–10:00 strip would make "you have no hours" look like "you have one
 * hour" — and stretched to whole hours around anything earlier or later, so
 * a 07:30 booking is never drawn off the top of the page.
 */
export function visibleRange(windows: readonly Window[]): Window {
  let start = 8 * 60;
  let end = 18 * 60;
  for (const w of windows) {
    if (w.endMinutes <= w.startMinutes) continue;
    start = Math.min(start, Math.floor(w.startMinutes / 60) * 60);
    end = Math.max(end, Math.ceil(w.endMinutes / 60) * 60);
  }
  return { startMinutes: Math.max(0, start), endMinutes: Math.min(24 * 60, end) };
}

/**
 * Where a booking sits on the grid: which of the week's dates, and the
 * minutes it spans on that date, in the business's zone.
 *
 * An appointment that runs past midnight is drawn to the bottom of its
 * start day rather than split in two; a business open at midnight is rare
 * enough that a second fragment on the next column would confuse more
 * people than it would help.
 */
export function placeBooking(
  startsAtIso: string,
  endsAtIso: string,
  timezone: string,
): { date: string; startMinutes: number; endMinutes: number } {
  const start = DateTime.fromISO(startsAtIso, { zone: 'utc' }).setZone(timezone);
  const end = DateTime.fromISO(endsAtIso, { zone: 'utc' }).setZone(timezone);
  const startMinutes = start.hour * 60 + start.minute;
  const sameDay = end.toFormat('yyyy-MM-dd') === start.toFormat('yyyy-MM-dd');
  const endMinutes = sameDay ? end.hour * 60 + end.minute : 24 * 60;
  return { date: start.toFormat('yyyy-MM-dd'), startMinutes, endMinutes };
}

/** Total minutes the windows cover, counting overlaps once. */
export function coveredMinutes(windows: readonly Window[]): number {
  const sorted = [...windows]
    .filter((w) => w.endMinutes > w.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes);
  let total = 0;
  let cursorEnd = -1;
  for (const w of sorted) {
    if (w.startMinutes >= cursorEnd) {
      total += w.endMinutes - w.startMinutes;
      cursorEnd = w.endMinutes;
    } else if (w.endMinutes > cursorEnd) {
      total += w.endMinutes - cursorEnd;
      cursorEnd = w.endMinutes;
    }
  }
  return total;
}
