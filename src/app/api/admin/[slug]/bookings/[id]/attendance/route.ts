import { fail, handleError, ok, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { missingReportColumn } from '@/lib/booking-service';
import type { Attendance, BookingRow } from '@/lib/db/types';

/**
 * Did they come? One tap on the Week after an appointment: 'attended',
 * 'no_show', or null to take the mark back. Only once it has started — a
 * no-show is not something to record in advance.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);
    const value = body.attendance;
    if (value !== null && value !== 'attended' && value !== 'no_show') {
      return fail('"attendance" must be attended, no_show or null', 400);
    }

    const { data, error } = await scope
      .select('bookings', 'id, starts_at, status')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    const booking = data as unknown as Pick<BookingRow, 'id' | 'starts_at' | 'status'> | null;
    if (!booking) return fail('Not found', 404);
    if (booking.status !== 'confirmed') return fail('A cancelled appointment has nobody to mark.', 409);
    if (new Date(booking.starts_at).getTime() > Date.now()) return fail('It hasn’t happened yet.', 409);

    const updated = await scope.update('bookings', { attendance: value as Attendance | null }).eq('id', id);
    if (updated.error) {
      if (missingReportColumn(updated.error))
        return fail('Marking attendance needs database migration 0033 first.', 503);
      throw updated.error;
    }
    return ok({ attendance: value });
  } catch (error) {
    return handleError(error);
  }
}
