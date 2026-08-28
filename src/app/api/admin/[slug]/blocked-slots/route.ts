import { handleError, ok, optionalString, readJson, requireDate, requireDateParam, requireTime } from '@/lib/api';
import { requireTenantMember } from '@/lib/auth';
import { createBlock, loadDayBlocks } from '@/lib/blocked-slot-service';
import { BookingError } from '@/lib/booking-service';

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

    const blocks = await loadDayBlocks(scope, tenant.timezone, date);
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

    const block = await createBlock(scope, tenant.timezone, {
      date,
      startTime,
      endTime,
      reason: reason ?? null,
    });
    return ok({ block }, 201);
  } catch (error) {
    return handleError(error);
  }
}
