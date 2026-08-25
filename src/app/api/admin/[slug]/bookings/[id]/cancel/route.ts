import { fail, handleError, ok, optionalString, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { cancelBooking } from '@/lib/booking-service';
import type { BookingRow } from '@/lib/db/types';

/**
 * Cancel from the dashboard side — the same cancelBooking used by a client's
 * own manage link (brief 2.4), so the two paths free the slot and remove the
 * calendar event identically rather than growing a second, slightly
 * different copy of that logic here.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);
    const reason = optionalString(body, 'reason', { maxLength: 500 });

    const { data, error } = await scope.select('bookings').eq('id', id).maybeSingle();
    if (error) throw error;

    const booking = data as unknown as BookingRow | null;
    if (!booking) return fail('Not found', 404);
    if (booking.status === 'cancelled') return fail('That booking is already cancelled', 409);

    await cancelBooking(tenant, scope, booking, reason);

    return ok({ cancelled: true });
  } catch (error) {
    return handleError(error);
  }
}
