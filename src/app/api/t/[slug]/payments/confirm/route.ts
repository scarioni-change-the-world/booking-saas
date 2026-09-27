import { fail, handleError, isResponse, ok, readJson, requireString, requireTenant } from '@/lib/api';
import { confirmReturn } from '@/lib/client-payments';
import type { EventTypeRow } from '@/lib/db/types';

/**
 * A client back from Stripe's payment page. Finishes the payment if the
 * webhook has not already (whichever is first makes the bookings; the other
 * finds it done), and says where it stands for the paid page.
 *
 * The Checkout Session id is the credential here, the way a manage token is
 * for a booking: Stripe puts it in the return address, and it is long and
 * unguessable. It is looked up only within this business.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;
    const { tenant, scope } = resolved;

    const body = await readJson(request);
    const sessionId = requireString(body, 'sessionId', { maxLength: 255 });
    if (!sessionId.startsWith('cs_')) return fail('Not found', 404);

    const business = { name: tenant.name, branding: tenant.branding ?? {} };
    const outcome = await confirmReturn(tenant, scope, sessionId);
    if (!outcome) return fail('Not found', 404);

    const home = `/t/${encodeURIComponent(slug)}`;
    if (outcome.status === 'pending' || outcome.status === 'expired') {
      return ok({ status: outcome.status, business, backLink: home });
    }
    if (outcome.status === 'failed') {
      const token = outcome.payment.booking_input.clientToken;
      return ok({
        status: 'failed',
        business,
        backLink: token ? `${home}/client/${encodeURIComponent(token)}` : home,
        message: outcome.message,
        amountMinor: outcome.payment.amount_minor,
        currency: outcome.payment.currency,
      });
    }

    const { payment, bookings, clientToken } = outcome;
    const { data } = await scope.select('event_types').eq('id', payment.event_type_id).maybeSingle();
    const eventType = data as unknown as EventTypeRow | null;

    return ok({
      status: 'paid',
      business,
      payment: {
        kind: payment.payment_mode,
        amountMinor: payment.amount_minor,
        currency: payment.currency,
        refundedMinor: payment.refunded_minor,
      },
      service: eventType
        ? { name: eventType.name, durationMinutes: eventType.duration_minutes }
        : { name: 'Your session', durationMinutes: null },
      email: payment.booking_input.email,
      bookings: bookings.map((b) => ({
        startsAt: b.starts_at,
        endsAt: b.ends_at,
        status: b.status,
        manageToken: b.manage_token,
        meetingUrl: b.meeting_url,
      })),
      programmeLink:
        payment.kind === 'pack' && clientToken
          ? `/t/${encodeURIComponent(slug)}/client/${encodeURIComponent(clientToken)}`
          : null,
      backLink: clientToken ? `${home}/client/${encodeURIComponent(clientToken)}` : home,
    });
  } catch (error) {
    return handleError(error);
  }
}
