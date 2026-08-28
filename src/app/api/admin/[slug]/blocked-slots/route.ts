import { DateTime } from 'luxon';
import {
  handleError,
  ok,
  optionalString,
  readJson,
  requireDate,
  requireDateParam,
  requireTime,
} from '@/lib/api';
import { requireTenantMember } from '@/lib/auth';
import { atLocalTime } from '@/lib/availability';
import { dayBoundsUtc, minutesIntoDay, parseTimeToMinutes } from '@/lib/blocked-slots';
import { BookingError } from '@/lib/booking-service';
import type { BlockedSlotRow } from '@/lib/db/types';

/**
 * Ad hoc blocked time, one calendar day at a time — the dashboard's "block
 * time" grid on the Availability page. `blocked_slots` itself (migration
 * 0002) is not new; nothing wrote to it before this route.
 *
 * `?date=` is required rather than optional: the grid always shows one day,
 * and every block this route returns is reshaped in terms of *that* day's
 * local minutes, which only means something for one date at a time.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantMember(request, slug);

    const params = new URL(request.url).searchParams;
    const date = requireDateParam(params, 'date');

    const bounds = dayBoundsUtc(date, tenant.timezone);
    if (!bounds) throw new BookingError('That date does not exist in this timezone', 400);

    const { data, error } = await scope
      .select('blocked_slots')
      .lt('starts_at', bounds.end.toUTC().toISO()!)
      .gt('ends_at', bounds.start.toUTC().toISO()!)
      .order('starts_at', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as unknown as BlockedSlotRow[];
    const blocks = rows.map((row) => ({
      id: row.id,
      startMinutes: minutesIntoDay(DateTime.fromISO(row.starts_at, { zone: 'utc' }), bounds),
      endMinutes: minutesIntoDay(DateTime.fromISO(row.ends_at, { zone: 'utc' }), bounds),
      reason: row.reason,
    }));

    return ok({ date, blocks });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Block an ad hoc stretch of time on one date.
 *
 * Wall-clock in, same as availability-rules and date-overrides — the caller
 * sends the local date and local start/end times it drew on the grid, and
 * this converts to the absolute instants blocked_slots actually stores.
 *
 * requireTenantMember, not requireTenantAdmin: blocking off an hour is
 * day-to-day diary work, open to any team member (migration 0005's
 * blocked_write policy already says so — this route is what finally uses it).
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantMember(request, slug);
    const body = await readJson(request);

    const date = requireDate(body, 'date');
    const startTime = requireTime(body, 'startTime');
    const endTime = requireTime(body, 'endTime');
    if (startTime >= endTime) {
      throw new BookingError('End time must be after the start time', 400);
    }
    const reason = optionalString(body, 'reason', { maxLength: 500 });

    const local = DateTime.fromISO(date, { zone: tenant.timezone }).startOf('day');
    const startsAt = atLocalTime(local, startTime);
    const endsAt = atLocalTime(local, endTime);
    if (!startsAt || !endsAt) {
      throw new BookingError('That time does not exist in this timezone on this date', 400);
    }

    const { data, error } = await scope.insert('blocked_slots', {
      starts_at: startsAt.toUTC().toISO()!,
      ends_at: endsAt.toUTC().toISO()!,
      reason: reason ?? null,
    });
    if (error) throw error;

    const row = (data as unknown as BlockedSlotRow[])[0]!;
    return ok(
      {
        block: {
          id: row.id,
          startMinutes: parseTimeToMinutes(startTime),
          endMinutes: parseTimeToMinutes(endTime),
          reason: row.reason,
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
