import { DateTime } from 'luxon';

/**
 * Slot generation.
 *
 * Ported from `lib/availability.js` in the single-tenant reference
 * implementation. Brief 5 flags this as the subtlest code in the product and
 * notes it was got wrong twice. The two rules that were got wrong are encoded
 * below and each has a dedicated test in tests/availability.test.ts.
 */

/** A window of wall-clock time on a given weekday, in the tenant's timezone. */
export interface AvailabilityRule {
  /** Luxon convention: 1 = Monday .. 7 = Sunday. */
  weekday: number;
  /** 'HH:mm' or 'HH:mm:ss', tenant-local. */
  startTime: string;
  endTime: string;
}

/** A holiday (closed) or a day with special hours, overriding the weekly rules. */
export interface DateOverride {
  /** 'yyyy-MM-dd', tenant-local. */
  date: string;
  isClosed: boolean;
  startTime?: string | null;
  endTime?: string | null;
}

export interface EventTypeTiming {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

/** An absolute interval during which the owner cannot take a booking. */
export interface BusyInterval {
  /** ISO 8601 instant. */
  start: string;
  end: string;
}

export interface SlotQuery {
  /** IANA zone, e.g. 'Europe/Madrid'. All wall-clock maths happens here. */
  timezone: string;
  /** Inclusive first date to consider, 'yyyy-MM-dd' tenant-local. */
  fromDate: string;
  /** Inclusive last date to consider, 'yyyy-MM-dd' tenant-local. */
  toDate: string;
  eventType: EventTypeTiming;
  availabilityRules: readonly AvailabilityRule[];
  dateOverrides: readonly DateOverride[];
  /** Union of confirmed bookings, ad-hoc blocks and external calendar busy. */
  busy: readonly BusyInterval[];
  /** Minimum lead time before the earliest offerable slot. */
  noticeHours: number;
  /** How far ahead bookings are accepted. 0 means unlimited (brief 5). */
  bookingWindowDays: number;
  /** Injectable clock. Tests pass a fixed instant; callers pass DateTime.now(). */
  now: DateTime;
}

export interface DaySlots {
  /** 'yyyy-MM-dd', tenant-local. */
  date: string;
  /** Slot start instants as UTC ISO strings, ascending. */
  slots: string[];
}

/**
 * Resolve the bookable wall-clock windows for one local date.
 *
 * A date override, when present, fully replaces the weekly rules for that date
 * rather than adding to them — a holiday closes the day outright, and special
 * hours mean *those* hours, not those plus the usual ones.
 *
 * Exported (not just an internal step of generateSlots) so the dashboard's ad
 * hoc hour-blocking grid can ask "what does this day normally look like?"
 * without a second copy of this rule — see the blocked-slots admin route and
 * the Availability page.
 */
export function windowsForDate(
  date: DateTime,
  rules: readonly AvailabilityRule[],
  overrides: ReadonlyMap<string, DateOverride>,
): Array<{ startTime: string; endTime: string }> {
  const iso = date.toFormat('yyyy-MM-dd');
  const override = overrides.get(iso);

  if (override) {
    if (override.isClosed) return [];
    if (!override.startTime || !override.endTime) return [];
    return [{ startTime: override.startTime, endTime: override.endTime }];
  }

  return rules
    .filter((r) => r.weekday === date.weekday)
    .map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
}

/**
 * Combine a local date with a wall-clock time in the tenant's zone.
 *
 * Returns null for a time that does not exist on that date — the hour skipped
 * by a spring-forward DST transition. Luxon silently normalises such a time to
 * the following hour, which would invent an availability window the tenant
 * never configured, so it is rejected explicitly instead.
 *
 * Exported so anywhere else that turns a tenant-local date + wall-clock time
 * into an absolute instant gets the same DST safety — see the blocked-slots
 * admin route, which uses it to turn a chosen block into starts_at/ends_at.
 */
export function atLocalTime(date: DateTime, time: string): DateTime | null {
  const parts = time.split(':');
  const hour = Number(parts[0]);
  const minute = Number(parts[1] ?? '0');
  const second = Number(parts[2] ?? '0');

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;

  const dt = date.set({ hour, minute, second, millisecond: 0 });
  if (!dt.isValid) return null;
  // A normalised nonexistent time comes back with a different wall clock than
  // the one asked for. That is the signal that the local time was skipped.
  if (dt.hour !== hour || dt.minute !== minute) return null;

  return dt;
}

/** An absolute busy range reduced to epoch milliseconds for cheap comparison. */
interface BusyMillis {
  start: number;
  end: number;
}

/** Merge overlapping and adjacent busy intervals so the overlap scan is cheap. */
function mergeBusy(busy: readonly BusyInterval[]): BusyMillis[] {
  const intervals = busy
    .map((b) => ({
      start: DateTime.fromISO(b.start),
      end: DateTime.fromISO(b.end),
    }))
    .filter((i) => i.start.isValid && i.end.isValid && i.end > i.start)
    .map((i) => ({ start: i.start.toMillis(), end: i.end.toMillis() }))
    .sort((a, b) => a.start - b.start);

  const merged: BusyMillis[] = [];
  for (const current of intervals) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/**
 * Generate every bookable slot in the requested date range.
 *
 * The inner loop is the reference implementation's, preserved deliberately:
 *
 *   1. The cursor steps by the session's own duration, never by a fixed global
 *      grid. A 60-minute session therefore only ever starts on the hour.
 *      Stepping by a fixed 15 minutes produced overlapping, ugly start times.
 *
 *   2. Buffers never shift the displayed start time. They widen the range used
 *      for conflict checking only. An earlier version added bufferBefore to the
 *      slot start and produced times like 2:20 PM, which confused clients.
 */
export function generateSlots(query: SlotQuery): DaySlots[] {
  const {
    timezone,
    fromDate,
    toDate,
    eventType,
    availabilityRules,
    dateOverrides,
    busy,
    noticeHours,
    bookingWindowDays,
    now,
  } = query;

  const { durationMinutes, bufferBeforeMinutes, bufferAfterMinutes } = eventType;
  if (durationMinutes <= 0) return [];

  const zonedNow = now.setZone(timezone);
  if (!zonedNow.isValid) {
    throw new Error(`Invalid timezone: ${timezone}`);
  }

  const earliestStart = zonedNow.plus({ hours: noticeHours });

  // 0 means unlimited (brief 5). Otherwise the window closes at the end of the
  // last permitted local day, so a 1-day window still yields all of tomorrow.
  const windowEndDate =
    bookingWindowDays > 0
      ? zonedNow.plus({ days: bookingWindowDays }).endOf('day')
      : null;

  const start = DateTime.fromISO(fromDate, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(toDate, { zone: timezone }).startOf('day');
  if (!start.isValid || !end.isValid || end < start) return [];

  const overrideByDate = new Map(dateOverrides.map((o) => [o.date, o]));
  const busyIntervals = mergeBusy(busy);

  const results: DaySlots[] = [];

  for (let day = start; day <= end; day = day.plus({ days: 1 })) {
    const daySlots: string[] = [];

    for (const window of windowsForDate(day, availabilityRules, overrideByDate)) {
      const windowStart = atLocalTime(day, window.startTime);
      const windowEnd = atLocalTime(day, window.endTime);
      if (!windowStart || !windowEnd || windowEnd <= windowStart) continue;

      let cursor = windowStart;

      // The session must finish, buffer included, inside the window.
      while (cursor.plus({ minutes: durationMinutes + bufferAfterMinutes }) <= windowEnd) {
        const slotStart = cursor;
        const blockStart = cursor.minus({ minutes: bufferBeforeMinutes });
        const blockEnd = cursor.plus({ minutes: durationMinutes + bufferAfterMinutes });

        const isTooSoon = slotStart < earliestStart;
        const isBeyondWindow = windowEndDate !== null && slotStart > windowEndDate;
        const blockStartMs = blockStart.toMillis();
        const blockEndMs = blockEnd.toMillis();
        const overlapsBusy = busyIntervals.some(
          (b) => blockStartMs < b.end && blockEndMs > b.start,
        );

        if (!isTooSoon && !isBeyondWindow && !overlapsBusy) {
          daySlots.push(slotStart.toUTC().toISO()!);
        }

        cursor = cursor.plus({ minutes: durationMinutes });
      }
    }

    if (daySlots.length > 0) {
      // Overlapping rules on the same weekday can produce the same instant
      // twice; the client should never see a duplicate.
      const unique = [...new Set(daySlots)].sort();
      results.push({ date: day.toFormat('yyyy-MM-dd'), slots: unique });
    }
  }

  return results;
}

/**
 * Confirm a specific instant is still bookable.
 *
 * The booking write path calls this rather than trusting the slot the client
 * submits: the list it was chosen from may be minutes stale, and nothing stops
 * a caller posting an arbitrary time straight to the API.
 */
export function isSlotBookable(query: SlotQuery, candidateIso: string): boolean {
  const candidate = DateTime.fromISO(candidateIso, { zone: 'utc' });
  if (!candidate.isValid) return false;

  const localDate = candidate.setZone(query.timezone).toFormat('yyyy-MM-dd');
  const days = generateSlots({ ...query, fromDate: localDate, toDate: localDate });
  const target = candidate.toUTC().toISO();

  return days.some((d) => d.slots.includes(target!));
}
