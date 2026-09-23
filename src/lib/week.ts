import { DateTime } from 'luxon';
import { minutesToTimeLabel, parseTimeToMinutes } from './blocked-slots';

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

/** Painting snaps to this. The same half hour the booking page offers slots on. */
export const CELL_MINUTES = 30;

export interface Window {
  startMinutes: number;
  endMinutes: number;
}

export interface WeeklyRule {
  weekday: number; // 1 = Monday … 7 = Sunday, Luxon's convention and the slot engine's
  startTime: string;
  endTime: string;
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
 * One weekday's usual hours as half-hour cells, for painting.
 *
 * A cell is on only when a rule covers ALL of it. A rule that opens at 09:15
 * therefore paints from 09:30, not 09:00 — narrowing is the safe direction.
 * Rounding the other way would offer clients a quarter of an hour the
 * business never said they were free, and the first they'd hear of it is a
 * booking at 09:00.
 */
export function rulesToCells(
  rules: readonly WeeklyRule[],
  weekday: number,
  range: Window,
): boolean[] {
  const windows = rules
    .filter((r) => r.weekday === weekday)
    .map((r) => ({ start: parseTimeToMinutes(r.startTime), end: parseTimeToMinutes(r.endTime) }));

  const cells: boolean[] = [];
  for (let m = range.startMinutes; m < range.endMinutes; m += CELL_MINUTES) {
    const end = m + CELL_MINUTES;
    cells.push(windows.some((w) => w.start <= m && w.end >= end));
  }
  return cells;
}

/**
 * Painted cells back into the windows the rules table stores.
 *
 * Adjacent cells merge into one window, so painting 09:00 to 17:00 saves as
 * one rule rather than sixteen. A window that reaches midnight is stored as
 * 23:59, because the database's time column has no 24:00 — it costs the
 * last minute of a day nobody books at.
 */
export function cellsToWindows(
  cells: readonly boolean[],
  range: Window,
): Array<{ startTime: string; endTime: string }> {
  const out: Array<{ startTime: string; endTime: string }> = [];
  let runStart: number | null = null;

  const close = (endMinutes: number) => {
    if (runStart === null) return;
    out.push({
      startTime: minutesToTimeLabel(runStart),
      endTime: endMinutes >= 24 * 60 ? '23:59' : minutesToTimeLabel(endMinutes),
    });
    runStart = null;
  };

  cells.forEach((on, i) => {
    const m = range.startMinutes + i * CELL_MINUTES;
    if (on && runStart === null) runStart = m;
    if (!on) close(m);
  });
  close(range.startMinutes + cells.length * CELL_MINUTES);

  return out;
}

/**
 * Whether saving this weekday from cells would change any of its times.
 *
 * True when a rule starts or ends off the half hour, or runs outside the
 * range on screen — either way painting that day would move it. The screen
 * says so before saving rather than after, because a start that quietly
 * moved from 08:45 to 09:00 is the kind of change nobody notices until a
 * client asks why they could not book the slot they always book.
 */
export function wouldShift(rules: readonly WeeklyRule[], weekday: number, range: Window): boolean {
  return rules
    .filter((r) => r.weekday === weekday)
    .some((r) => {
      const start = parseTimeToMinutes(r.startTime);
      const end = parseTimeToMinutes(r.endTime);
      return (
        start % CELL_MINUTES !== 0 ||
        end % CELL_MINUTES !== 0 ||
        start < range.startMinutes ||
        end > range.endMinutes
      );
    });
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
