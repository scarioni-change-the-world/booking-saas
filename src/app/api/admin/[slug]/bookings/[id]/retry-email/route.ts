import { fail, handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { retryBookingEmail } from '@/lib/booking-email';
import type { BookingRow } from '@/lib/db/types';

/**
 * Re-attempt the client email for one booking — surfaced next to a
 * "failed" badge on the admin Bookings list. Always returns 200 with
 * whatever the retry actually achieved (email_status in the body), rather
 * than a 4xx/5xx on a still-failing send: the retry itself succeeded at
 * being attempted, whatever the mail server did with it. The frontend
 * reads the returned status to show "sent" or "still failing" — see
 * retryBookingEmail's own doc comment on which template a retry resends.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);

    const { data, error } = await scope.select('bookings').eq('id', id).maybeSingle();
    if (error) throw error;

    const booking = data as unknown as BookingRow | null;
    if (!booking) return fail('Not found', 404);

    const emailStatus = await retryBookingEmail(tenant, scope, booking);

    return ok({ emailStatus });
  } catch (error) {
    return handleError(error);
  }
}
