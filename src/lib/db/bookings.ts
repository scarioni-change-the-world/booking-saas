import { __unsafeServiceClient } from './client';
import type { BookingRow } from './types';

/**
 * Platform-wide booking reads, for work that belongs to no single tenant.
 *
 * Everything else in this app reaches bookings through a TenantScope. These
 * two do not, because a scheduled sweep has no tenant to be acting for —
 * the same reasoning console.ts uses for its cross-tenant listings, and
 * with the same safeguard: the only caller is a route that authenticates
 * against CRON_SECRET, and each booking it finds is then handled through
 * its own tenant's scope.
 */

/**
 * Confirmed bookings starting soon that have not had a reminder.
 *
 * Deliberately unscoped, like listAllTenants in console.ts: a scheduled
 * sweep runs for the whole platform, not on behalf of one business, so
 * there is no tenant to scope it to. What makes that safe is the caller —
 * the only route that reaches this is the cron endpoint, which authenticates
 * against CRON_SECRET and does nothing else, and each booking is then
 * handled through its own tenant's scope.
 *
 * The window is bounded by its caller, and the ceiling is the half that
 * matters: without one, the first run after this ships would remind
 * everyone about everything. There is deliberately no floor. An earlier
 * version held reminders back until a booking was a couple of hours out, on
 * the reasoning that a reminder arriving moments after the confirmation
 * reads as a mistake. On a once-a-day schedule that floor silently drops
 * bookings made after a run for early the next morning, which is the worse
 * failure of the two — see the window constants in the cron route.
 *
 * Cancelled bookings are excluded by status. A reminder about an
 * appointment somebody already cancelled is worse than no reminder: it
 * makes them think the cancellation did not work.
 *
 * Ordered by start time so that if a run is cut short — a serverless
 * timeout, a rate limit — the appointments it did reach are the ones
 * happening soonest, which are the ones a reminder still helps.
 */
export async function bookingsDueAReminder(
  fromIso: string,
  toIso: string,
  limit: number,
): Promise<BookingRow[]> {
  const { data, error } = await __unsafeServiceClient()
    .from('bookings')
    .select('*')
    .eq('status', 'confirmed')
    .is('reminder_sent_at', null)
    .gte('starts_at', fromIso)
    .lte('starts_at', toIso)
    .order('starts_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as BookingRow[];
}

/**
 * Claim a booking's reminder, returning false if somebody already had it.
 *
 * Marked before the email is attempted rather than after, and conditionally
 * on it still being unclaimed. Both halves matter. Claiming first means a
 * crash, a timeout or an overlapping run cannot produce a second reminder —
 * and a duplicate reminder is the failure people actually notice and
 * complain about, where a missing one is invisible. The conditional update
 * is what makes two simultaneous runs safe without a lock: the second one
 * updates no rows and is told so.
 *
 * The cost is that a send failure means no reminder rather than a retry.
 * That is the right trade for this: email here is best-effort by design
 * (see the module header), the failure is logged, and the alternative is a
 * stuck row that retries every hour until someone notices.
 */
export async function claimReminder(bookingId: string): Promise<boolean> {
  const { data, error } = await __unsafeServiceClient()
    .from('bookings')
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq('id', bookingId)
    .is('reminder_sent_at', null)
    .select('id');

  if (error) throw error;
  return (data ?? []).length > 0;
}
