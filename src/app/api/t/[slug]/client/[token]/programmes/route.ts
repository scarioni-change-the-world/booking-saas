import { fail, handleError, isResponse, ok, readJson, requireString, requireTenant } from '@/lib/api';
import { BookingError, createBookingPack, resolveClientByToken } from '@/lib/booking-service';
import { enforceRateLimit } from '@/lib/rate-limit';

const MAX_SLOTS_PER_REQUEST = 20;

/**
 * Buy another programme, as somebody the business already knows.
 *
 * The same createBookingPack the public page uses, given the client's own
 * name and email rather than a form's: the appointments, the client record
 * and the balance are one transaction there, and duplicating any of that
 * here would be a second way to do a thing that already has one.
 *
 * No questionnaire, and that is the point — a person holding this link has
 * already been through it, and a business that wants them screened again
 * simply does not offer the service to existing clients. The audience flag
 * is the control; this route only honours it.
 *
 * Rate limited like the rest of the public surface. The token is the
 * credential, so a leaked one should not also be a way to fill somebody's
 * diary.
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
    await enforceRateLimit(request, tenant.id, 'booking');

    const client = await resolveClientByToken(scope, token);
    if (!client) return fail('Not found', 404);

    const body = await readJson(request);
    const eventTypeId = requireString(body, 'eventTypeId', { maxLength: 64 });

    const raw = body.slots;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BookingError('Pick your times first', 400);
    }
    if (raw.length > MAX_SLOTS_PER_REQUEST) {
      throw new BookingError(`Pick at most ${MAX_SLOTS_PER_REQUEST} times at once`, 400);
    }
    const slots = raw.map((value, i) => {
      if (typeof value !== 'string' || value.length > 40) {
        throw new BookingError(`"slots[${i}]" is not a valid time`, 400);
      }
      return value;
    });

    /* createBookingPack checks against the service that a pack is what this
       really is, and that the number of times matches what it is sold as —
       so a caller sending three slots for a ten-session programme is
       refused there rather than quietly buying a short one. */
    const created = await createBookingPack(tenant, scope, {
      eventTypeId,
      slots,
      name: client.name,
      email: client.email,
      clientId: client.id,
    });

    return ok(
      {
        bookings: created.bookings.map((booking) => ({
          id: booking.id,
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
          manageToken: booking.manage_token,
          meetingUrl: booking.meeting_url,
          confirmationEmailSent: booking.email_status === 'sent',
        })),
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
