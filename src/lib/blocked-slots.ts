import { DateTime } from 'luxon';
import { atLocalTime } from './availability';

/**
 * Small, pure helpers behind the ad hoc hour-blocking feature — the admin
 * dashboard's "block time" grid (Availability page) and its API route.
 *
 * Kept separate from availability.ts because this is a different job: that
 * module decides what a *prospect* can book; this one turns a tenant's
 * click-or-drag selection on a calendar day into the wall-clock minutes and
 * absolute instants blocked_slots actually stores. It leans on
 * availability.ts's atLocalTime for the one place both need the same DST
 * care: turning a tenant-local wall-clock moment into a real instant.
 */

/** Minutes since local midnight, always in [0, 1440]. 1440 means "midnight, the next day". */
export type MinuteOfDay = number;

/** Parse "HH:mm" or "HH:mm:ss" into minutes since midnight. */
export function parseTimeToMinutes(time: string): MinuteOfDay {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Format minutes since midnight back to "HH:mm", for display only — never
 * fed back into requireTime, so the otherwise-invalid "24:00" some computed
 * values could reach (an existing block that runs past this local day) is
 * fine to clamp down to "23:59" rather than reject.
 */
export function minutesToTimeLabel(minutes: MinuteOfDay): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The absolute UTC instant bounds of one tenant-local calendar date.
 *
 * Calendar-day arithmetic, not a fixed 24 hours — `end` is the same local
 * midnight the following day, whatever that turns out to be in UTC. On a
 * spring-forward day that span is 23 real hours, not 24; using a fixed
 * `+ 24h` here would silently include an hour of the wrong day.
 *
 * Returns null only for the local midnight that does not exist on this date
 * — see atLocalTime. In practice this never happens: every DST transition in
 * the IANA database lands well after midnight.
 */
export function dayBoundsUtc(
  date: string,
  timezone: string,
): { start: DateTime; end: DateTime } | null {
  const local = DateTime.fromISO(date, { zone: timezone }).startOf('day');
  if (!local.isValid) return null;

  const start = atLocalTime(local, '00:00');
  if (!start) return null;

  return { start, end: start.plus({ days: 1 }) };
}

/**
 * Where a stored instant falls within one local calendar day, as a
 * wall-clock minute-of-day — clamped to [0, 1440] so a block that starts
 * before this day, or runs past it, still renders sensibly instead of a
 * negative or over-1440 offset the grid has no cell for.
 *
 * Reads the instant's own local hour/minute rather than diffing elapsed real
 * time from `bounds.start` — those two disagree by an hour on a DST
 * transition day (real elapsed minutes to "09:00" local is only 480 on a
 * spring-forward day, not 540), and the grid's cells are labelled by
 * wall-clock time, not elapsed duration. Getting this wrong would misplace
 * every existing block on that one day of the year.
 */
export function minutesIntoDay(
  instant: DateTime,
  bounds: { start: DateTime; end: DateTime },
): MinuteOfDay {
  if (instant <= bounds.start) return 0;
  if (instant >= bounds.end) return 1440;

  const local = instant.setZone(bounds.start.zone);
  return local.hour * 60 + local.minute;
}
