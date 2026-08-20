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
