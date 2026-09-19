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
import { createBooking } from '@/lib/booking-service';
import { enforceRateLimit } from '@/lib/rate-limit';
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

    // Before the qualification check below, not after: a caller throwing
    // invalid attempts at this endpoint is exactly who this is for, and
    // they should spend their allowance doing it. Every booking here takes
    // a real calendar slot and sends real mail (src/lib/booking-email.ts).
    await enforceRateLimit(request, tenant.id, 'booking');

    const body = await readJson(request);

    const responseId = optionalString(body, 'responseId', { maxLength: 64 }) ?? null;
    if (!responseId) return fail('Complete the questions first', 403);

    const { data, error } = await scope
      .select('qualification_responses')
      .eq('id', responseId)
      .maybeSingle();
    if (error) throw error;

    const response = data as unknown as QualificationResponseRow | null;
    if (response?.outcome_path_type !== 'meeting') {
      return fail('Complete the questions first', 403);
    }

    const booking = await createBooking(tenant, scope, {
      eventTypeId: requireString(body, 'eventTypeId', { maxLength: 64 }),
      startsAt: requireString(body, 'startsAt', { maxLength: 40 }),
      name: requireString(body, 'name', { maxLength: 200 }),
      email: requireEmail(body, 'email'),
      notes: optionalString(body, 'notes', { maxLength: 5000 }),
      qualificationResponseId: responseId,
    });

    // The confirmation email (with .ics and the manage link) and the
    // owner notification already went out from inside createBooking —
    // src/lib/booking-email.ts, brief 7.5.

    return ok(
      {
        booking: {
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
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
