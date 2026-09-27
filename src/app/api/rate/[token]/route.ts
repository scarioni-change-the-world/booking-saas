import { fail, handleError, ok, optionalString, readJson } from '@/lib/api';
import { resolveBookingByToken } from '@/lib/db';
import type { EventTypeRow, SessionRatingRow } from '@/lib/db/types';

/**
 * Rating a session, from the link in the "How was it?" email. The booking's
 * own token is the credential, as it is for managing it. Open from the
 * moment the session starts until 60 days after; a rating can be changed in
 * that time, and the last answer is the one kept.
 */

const OPEN_DAYS = 60;

async function load(token: string) {
  const resolved = await resolveBookingByToken(token);
  if (!resolved) return null;
  const { data } = await resolved.scope
    .select('event_types', 'name')
    .eq('id', resolved.booking.event_type_id)
    .maybeSingle();
  const existing = await resolved.scope
    .select('session_ratings')
    .eq('booking_id', resolved.booking.id)
    .maybeSingle();
  return {
    ...resolved,
    serviceName: (data as unknown as Pick<EventTypeRow, 'name'> | null)?.name ?? 'your session',
    rating: existing.error ? null : ((existing.data as unknown as SessionRatingRow | null) ?? null),
    ratingsAvailable: !existing.error,
  };
}

function state(startsAt: string, status: string): 'open' | 'not_yet' | 'closed' | 'cancelled' {
  if (status !== 'confirmed') return 'cancelled';
  const start = new Date(startsAt).getTime();
  if (start > Date.now()) return 'not_yet';
  if (Date.now() - start > OPEN_DAYS * 24 * 3600 * 1000) return 'closed';
  return 'open';
}

export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const found = await load(token);
    if (!found) return fail('Not found', 404);
    const { booking, tenant } = found;
    return ok({
      business: { name: tenant.name, branding: tenant.branding ?? {} },
      serviceName: found.serviceName,
      startsAt: booking.starts_at,
      clientName: booking.name,
      state: found.ratingsAvailable ? state(booking.starts_at, booking.status) : 'closed',
      rating: found.rating ? { rating: found.rating.rating, comment: found.rating.comment } : null,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const found = await load(token);
    if (!found) return fail('Not found', 404);
    const { booking, scope } = found;
    const now = state(booking.starts_at, booking.status);
    if (now === 'not_yet') return fail('You can rate it once it has happened.', 409);
    if (now !== 'open' || !found.ratingsAvailable) return fail('This session can no longer be rated.', 409);

    const body = await readJson(request);
    const rating = body.rating;
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return fail('Choose from one to five.', 400);
    }
    const comment = optionalString(body, 'comment', { maxLength: 2000 }) ?? null;

    const result = found.rating
      ? await scope.update('session_ratings', { rating, comment }).eq('id', found.rating.id)
      : await scope.insert('session_ratings', { booking_id: booking.id, rating, comment });
    if (result.error) throw result.error;
    return ok({ rating, comment });
  } catch (error) {
    return handleError(error);
  }
}
