import {
  handleError,
  isResponse,
  ok,
  optionalString,
  readJson,
  requireEmail,
  requireString,
  requireTenant,
  fail,
} from '@/lib/api';
import { createBooking, createBookingPack } from '@/lib/booking-service';
import { enforceRateLimit } from '@/lib/rate-limit';
import { serviceAsksProspectAnything } from '@/lib/qualification-response-service';
import { BookingError } from '@/lib/booking-service';
import { isTestRun } from '@/lib/test-run-server';
import type { QualificationResponseRow } from '@/lib/db/types';

/**
 * Create a booking — the prospect path.
 *
 * Always requires a qualified response id, for the same reason the
 * availability endpoint does: the gate has to hold at every door into the
 * calendar, not just the one the widget happens to use.
 *
 * There used to be a second, client-audience path here, identified by
 * nothing more than a request-body flag — anyone could set it, so a
 * client-only session type rested on the URL being unlisted rather than on
 * any real identity check. An existing client now books through their own
 * token instead: .../client/[token]/single-session for a one-off session,
 * .../client/[token]/bookings for redeeming a package. Both resolve a real
 * clients row from the token before creating anything.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { tenant, scope } = resolved;

    /* A test run books nothing: no row, no calendar event, no email, no
       count. It answers the way a real booking would, so the page shows
       its confirmation screen and the flow beside it reaches Booked. */
    if (await isTestRun(request, slug)) {
      const body = await readJson(request);
      requireString(body, 'eventTypeId', { maxLength: 64 });
      const times = requireSlotsIfPresent(body) ?? [requireString(body, 'startsAt', { maxLength: 40 })];
      const shaped = times.map((startsAt, i) => ({
        id: `test-${i}`,
        startsAt,
        endsAt: startsAt,
        manageToken: 'test',
        meetingUrl: null,
        confirmationEmailSent: false,
      }));
      return ok({ booking: shaped[0]!, bookings: shaped, programmeLink: null, test: true }, 201);
    }

    // Before the qualification check below, not after: a caller throwing
    // invalid attempts at this endpoint is exactly who this is for, and
    // they should spend their allowance doing it. Every booking here takes
    // a real calendar slot and sends real mail (src/lib/booking-email.ts).
    await enforceRateLimit(request, tenant.id, 'booking');

    const body = await readJson(request);

    const eventTypeId = requireString(body, 'eventTypeId', { maxLength: 64 });
    const responseId = optionalString(body, 'responseId', { maxLength: 64 }) ?? null;

    // The same rule the calendar applies: a completed questionnaire on the
    // meeting path is required whenever there is a questionnaire. A service
    // that asks nothing has nothing to withhold, and demanding a response id
    // for it made a business with no screening unable to take any booking at
    // all — see serviceAsksProspectAnything.
    //
    // Checked against the database, never against the request: a caller
    // simply omitting responseId must not be able to talk its way past the
    // gate on a service that does ask.
    let onMeetingPath = false;
    if (responseId) {
      const { data, error } = await scope
        .select('qualification_responses')
        .eq('id', responseId)
        .maybeSingle();
      if (error) throw error;
      const response = data as unknown as QualificationResponseRow | null;
      onMeetingPath = response?.outcome_path_type === 'meeting';
    }

    if (!onMeetingPath && (await serviceAsksProspectAnything(scope, eventTypeId))) {
      return fail('Complete the questions first', 403);
    }

    const common = {
      eventTypeId,
      name: requireString(body, 'name', { maxLength: 200 }),
      email: requireEmail(body, 'email'),
      notes: optionalString(body, 'notes', { maxLength: 5000 }),
      qualificationResponseId: responseId,
    };

    /* A pack is asked for by sending `slots` instead of `startsAt`. Which one
       the caller sent decides the path, and createBookingPack then checks
       against the *service* that a pack is what it really is — so sending
       ten slots for a single-appointment service is refused there rather
       than quietly booking ten separate appointments. */
    const packSlots = requireSlotsIfPresent(body);

    const created = packSlots
      ? await createBookingPack(tenant, scope, { ...common, slots: packSlots })
      : {
          bookings: [
            await createBooking(tenant, scope, {
              ...common,
              startsAt: requireString(body, 'startsAt', { maxLength: 40 }),
            }),
          ],
          clientToken: null,
        };

    const { bookings, clientToken } = created;

    // The confirmation email (with .ics and the manage link) and the
    // owner notification already went out from inside createBooking /
    // createBookingPack — src/lib/booking-email.ts, brief 7.5.

    const shaped = bookings.map((booking) => ({
      id: booking.id,
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      manageToken: booking.manage_token,
      meetingUrl: booking.meeting_url,
      // A boolean, not the email_status enum, because a stranger needs
      // to know whether to expect an email and nothing else. 'failed'
      // and 'not_configured' differ only to the operator — who sees
      // both, with the reason, on the booking in their dashboard — and
      // telling a visitor which one would describe the state of a mail
      // server to someone with no business knowing it.
      confirmationEmailSent: booking.email_status === 'sent',
    }));

    /* `booking` stays in the response, always, and for a pack it is the
       first appointment. Removing it would break the confirmation screen
       for every single booking, and a pack's first appointment is the one
       that screen leads with anyway. */
    /* Buying a programme makes somebody a client with a balance, so the
       confirmation hands them their own link rather than leaving it to an
       admin to send. Every other link in this response manages one
       appointment; this is the only one that reaches the programme. */
    return ok(
      {
        booking: shaped[0]!,
        bookings: shaped,
        programmeLink: clientToken
          ? `/t/${encodeURIComponent(slug)}/client/${encodeURIComponent(clientToken)}`
          : null,
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}

/**
 * The slots of a pack, or null when this is an ordinary booking.
 *
 * Validated to the shape only — that these are strings, that there are a
 * plausible number of them, that none is absurdly long. Whether they are
 * real, available times for a service that is actually sold as a pack is
 * createBookingPack's job, against the database, where the answer cannot be
 * argued with.
 */
function requireSlotsIfPresent(body: Record<string, unknown>): string[] | null {
  if (body.slots === undefined || body.slots === null) return null;

  const value = body.slots;
  if (!Array.isArray(value) || value.length === 0) {
    throw new BookingError('"slots" must be a list of times', 400);
  }
  // Ten is the product's ceiling (migration 0014); the check here is a
  // bound on what an unauthenticated caller can make this route do, not the
  // business rule — that lives with the service.
  if (value.length > 10) {
    throw new BookingError('That is more appointments than any programme has', 400);
  }
  if (!value.every((item) => typeof item === 'string' && item.length <= 40)) {
    throw new BookingError('"slots" must be a list of times', 400);
  }

  return value as string[];
}
