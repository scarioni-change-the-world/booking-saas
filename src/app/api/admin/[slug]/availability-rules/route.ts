import { handleError, ok, readJson, requireInt, requireTime } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeAvailabilityRule } from '@/lib/admin-serializers';
import { BookingError } from '@/lib/booking-service';
import type { AvailabilityRuleRow } from '@/lib/db/types';

/**
 * The weekly recurring schedule — every rule, every weekday.
 *
 * A weekday can carry more than one rule (a split shift: 09:00–13:00 and
 * 15:00–19:00 on the same day), so this is a plain list rather than one row
 * per day; the dashboard groups it by weekday for display.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { data, error } = await scope
      .select('availability_rules')
      .order('weekday', { ascending: true })
      .order('start_time', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as unknown as AvailabilityRuleRow[];
    return ok({ rules: rows.map(serializeAvailabilityRule) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Add one window of hours to one weekday.
 *
 * No overlap check against the tenant's other rules for that day — a
 * tenant entering 09:00–13:00 and then 12:00–17:00 by mistake gets two
 * overlapping rules rather than a rejected request. The slot engine already
 * treats overlapping rules correctly (it de-duplicates the instants they'd
 * otherwise produce twice — see tests/availability.test.ts), so an overlap
 * here is odd but not broken, and not worth a hard stop on day one.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const weekday = requireInt(body, 'weekday', { min: 1, max: 7 });
    const startTime = requireTime(body, 'startTime');
    const endTime = requireTime(body, 'endTime');

    if (startTime >= endTime) {
      throw new BookingError('End time must be after the start time', 400);
    }

    const { data, error } = await scope.insert('availability_rules', {
      weekday,
      start_time: startTime,
      end_time: endTime,
    });
    if (error) throw error;

    const row = (data as unknown as AvailabilityRuleRow[])[0]!;
    return ok({ rule: serializeAvailabilityRule(row) }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Replace the usual hours of whole weekdays in one go — what saving a
 * painted week does.
 *
 * `{ days: [{ weekday, windows: [{ startTime, endTime }] }] }`. Every
 * weekday named is replaced entirely; weekdays not named are not touched,
 * so painting Tuesday cannot disturb Thursday. An empty `windows` closes
 * that weekday.
 *
 * NEW ROWS GO IN BEFORE OLD ROWS COME OUT. There is no transaction across
 * these two statements, so the order decides what a failure in between
 * looks like. This way it leaves both sets for a moment — overlapping
 * hours, which the slot engine already de-duplicates — and never a weekday
 * with no hours at all, which would quietly stop the business taking
 * bookings until somebody noticed.
 */
export async function PUT(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    if (!Array.isArray(body.days) || body.days.length === 0 || body.days.length > 7) {
      throw new BookingError('"days" must list between one and seven weekdays', 400);
    }

    const seen = new Set<number>();
    const replacements: Array<{ weekday: number; start_time: string; end_time: string }> = [];

    for (const raw of body.days as unknown[]) {
      if (!raw || typeof raw !== 'object') throw new BookingError('Each day must be an object', 400);
      const day = raw as Record<string, unknown>;
      const weekday = requireInt(day, 'weekday', { min: 1, max: 7 });
      if (seen.has(weekday)) throw new BookingError('A weekday can only appear once', 400);
      seen.add(weekday);

      if (!Array.isArray(day.windows) || day.windows.length > 24) {
        throw new BookingError('"windows" must be a list of at most 24 time ranges', 400);
      }
      for (const w of day.windows as unknown[]) {
        if (!w || typeof w !== 'object') throw new BookingError('Each window must be an object', 400);
        const win = w as Record<string, unknown>;
        const startTime = requireTime(win, 'startTime');
        const endTime = requireTime(win, 'endTime');
        if (startTime >= endTime) throw new BookingError('End time must be after the start time', 400);
        replacements.push({ weekday, start_time: startTime, end_time: endTime });
      }
    }

    const weekdays = [...seen];
    const existing = await scope.select('availability_rules', 'id').in('weekday', weekdays);
    if (existing.error) throw existing.error;
    const oldIds = ((existing.data ?? []) as unknown as Array<{ id: string }>).map((r) => r.id);

    if (replacements.length > 0) {
      const inserted = await scope.insert('availability_rules', replacements);
      if (inserted.error) throw inserted.error;
    }

    if (oldIds.length > 0) {
      const removed = await scope.delete('availability_rules').in('id', oldIds);
      if (removed.error) throw removed.error;
    }

    const { data, error } = await scope
      .select('availability_rules')
      .order('weekday', { ascending: true })
      .order('start_time', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as unknown as AvailabilityRuleRow[];
    return ok({ rules: rows.map(serializeAvailabilityRule) });
  } catch (error) {
    return handleError(error);
  }
}
