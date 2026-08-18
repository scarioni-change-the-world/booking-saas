import { DateTime } from 'luxon';
import { generateSlots } from '@/lib/availability';
import { fail, handleError, ok } from '@/lib/api';
import { buildSlotQuery } from '@/lib/booking-service';
import { resolveBookingByToken } from '@/lib/db';

/**
 * Available times for a reschedule (brief 2.4).
 *
 * The token is the credential, and it scopes the request to exactly one
 * booking — there is no event type or tenant parameter to tamper with.
 *
 * The booking's own slot is removed from the busy set before generating. Left
 * in, a booking would always conflict with itself, its current time would never
 * be offered back, and a client who opened the picker and changed their mind
 * would find the slot they already hold apparently taken.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const resolved = await resolveBookingByToken(token);
    if (!resolved) return fail('Not found', 404);

    const { booking, tenant, scope } = resolved;
    if (booking.status === 'cancelled') return fail('That booking was cancelled', 409);

    const today = DateTime.now().setZone(tenant.timezone);
    const query = await buildSlotQuery(
      tenant,
      scope,
      booking.event_type_id,
      today.toFormat('yyyy-MM-dd'),
      today.plus({ days: 30 }).toFormat('yyyy-MM-dd'),
    );

    const withoutSelf = {
      ...query,
      busy: query.busy.filter(
        (b) => !(b.start === booking.starts_at && b.end === booking.ends_at),
      ),
    };

    return ok({ timezone: tenant.timezone, days: generateSlots(withoutSelf) });
  } catch (error) {
    return handleError(error);
  }
}
