import {
  fail,
  handleError,
  isResponse,
  ok,
  optionalString,
  readJson,
  requireString,
  requireTenant,
} from '@/lib/api';
import { createBooking, loadEventType, resolveClientByToken } from '@/lib/booking-service';

/**
 * A known client booking a one-off session outright — no package involved.
 *
 * Deliberately its own route rather than a mode on .../bookings (the entitlement
 * batch endpoint just above this one): that one draws down a specific package
 * and is inherently a batch (several sessions in one visit); this one books
 * exactly one, straight against the calendar, the same way createBooking
 * already works for a prospect. The only thing this route adds on top of
 * createBooking is *who* — the client resolved from the token, stamped onto
 * the booking (client_id) the same way entitlement redemption already does.
 *
 * Restricted to booking_mode 'single': a 'pack' type must be booked through
 * the entitlement it draws down, never as a free-standing booking, or a
 * client could book a "pack" session without ever holding a package for it.
 * See GET .../client/[token], which only ever offers this route's event
 * types under singleEventTypes for exactly that reason.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ slug: string; token: string }> },
) {
  try {
    const { slug, token } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { tenant, scope } = resolved;
    const client = await resolveClientByToken(scope, token);
    if (!client) return fail('Not found', 404);

    const body = await readJson(request);
    const eventTypeId = requireString(body, 'eventTypeId', { maxLength: 64 });

    const eventType = await loadEventType(scope, eventTypeId);
    if (!eventType.available_to_existing_clients || eventType.booking_mode !== 'single') {
      return fail('That session is not available to book this way', 400);
    }

    const booking = await createBooking(tenant, scope, {
      eventTypeId,
      startsAt: requireString(body, 'startsAt', { maxLength: 40 }),
      name: client.name,
      email: client.email,
      notes: optionalString(body, 'notes', { maxLength: 5000 }),
      clientId: client.id,
    });

    // The confirmation email (with .ics and the manage link) and the owner
    // notification already went out from inside createBooking.

    return ok(
      {
        booking: {
          id: booking.id,
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
          manageToken: booking.manage_token,
          meetingUrl: booking.meeting_url,
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
