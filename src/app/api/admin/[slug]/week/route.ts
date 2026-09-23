import { DateTime } from 'luxon';
import { handleError, ok, requireDateParam } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeAvailabilityRule, serializeDateOverride } from '@/lib/admin-serializers';
import { windowsForDate } from '@/lib/availability';
import { parseTimeToMinutes } from '@/lib/blocked-slots';
import { loadDayBlocks } from '@/lib/blocked-slot-service';
import { mondayOf, weekDates } from '@/lib/week';
import type { AvailabilityRuleRow, DateOverrideRow } from '@/lib/db/types';

/**
 * One week of a business's time, in the business's own zone: the usual
 * hours, what is different on each date, and what has been blocked.
 *
 * Bookings are not in here — they come from the bookings route with
 * view=range, which already knows how to describe a programme or a second
 * attempt, and two copies of that logic would drift.
 *
 * The open windows are worked out with windowsForDate, the same function the
 * slot engine uses to decide what a client can book. So what this screen
 * paints as open is, by construction, what the booking page offers.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);

    const params = new URL(request.url).searchParams;
    const monday = mondayOf(requireDateParam(params, 'from'));
    const dates = weekDates(monday);

    const [rulesResult, overridesResult, blocksByDay] = await Promise.all([
      scope.select('availability_rules').order('weekday').order('start_time'),
      scope.select('date_overrides').gte('date', dates[0]!).lte('date', dates[6]!),
      Promise.all(dates.map((date) => loadDayBlocks(scope, tenant.timezone, date))),
    ]);
    if (rulesResult.error) throw rulesResult.error;
    if (overridesResult.error) throw overridesResult.error;

    const rules = ((rulesResult.data ?? []) as unknown as AvailabilityRuleRow[]).map(
      serializeAvailabilityRule,
    );
    const overrides = ((overridesResult.data ?? []) as unknown as DateOverrideRow[]).map(
      serializeDateOverride,
    );
    const overrideMap = new Map(overrides.map((o) => [o.date, o]));

    return ok({
      timezone: tenant.timezone,
      monday,
      rules,
      days: dates.map((date, i) => ({
        date,
        weekday: i + 1,
        windows: windowsForDate(DateTime.fromISO(date), rules, overrideMap)
          .map((w) => ({
            startMinutes: parseTimeToMinutes(w.startTime),
            endMinutes: parseTimeToMinutes(w.endTime),
          }))
          .filter((w) => w.endMinutes > w.startMinutes),
        override: overrideMap.get(date) ?? null,
        blocks: blocksByDay[i]!,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}
