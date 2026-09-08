import {
  fail,
  handleError,
  ok,
  optionalString,
  readJson,
  requireString,
} from '@/lib/api';
import { BookingError, cancelBooking, rescheduleBooking } from '@/lib/booking-service';
import { resolveBookingByToken } from '@/lib/db';
import type { EventTypeRow } from '@/lib/db/types';

/**
 * Self-service management (brief 2.4).
 *
 * No login — the unguessable token IS the credential. A token that does not
 * resolve gets the same 404 as one that resolves to nothing, so this endpoint
 * cannot be used to test whether a token is valid.
 */

async function load(token: string) {
  const resolved = await resolveBookingByToken(token);
  if (!resolved) return null;

  const { data } = await resolved.scope
    .select('event_types')
    .eq('id', resolved.booking.event_type_id)
    .maybeSingle();

  return { ...resolved, eventType: data as unknown as EventTypeRow | null };
}

export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const resolved = await load(token);
    if (!resolved) return fail('Not found', 404);

    const { booking, tenant, eventType } = resolved;

    return ok({
      booking: {
        startsAt: booking.starts_at,
        endsAt: booking.ends_at,
        name: booking.name,
        email: booking.email,
        notes: booking.notes,
        status: booking.status,
        meetingUrl: booking.meeting_url,
        eventTypeId: booking.event_type_id,
        eventTypeName: eventType?.name ?? null,
      },
      tenant: { name: tenant.name, timezone: tenant.timezone, branding: tenant.branding },
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const resolved = await load(token);
    if (!resolved) return fail('Not found', 404);

    const { booking, tenant, scope } = resolved;
    const body = await readJson(request);
    const action = requireString(body, 'action', { maxLength: 20 });

    if (action === 'cancel') {
      // The cancellation email goes out from inside cancelBooking itself
      // (src/lib/booking-email.ts) — the same function the admin-side
      // cancel route calls, so both paths notify the client identically.
      await cancelBooking(tenant, scope, booking, optionalString(body, 'reason', { maxLength: 2000 }));
      return ok({ status: 'cancelled' });
    }

    if (action === 'reschedule') {
      // Same posture: the reschedule confirmation email goes out from
      // inside rescheduleBooking itself.
      const moved = await rescheduleBooking(
        tenant,
        scope,
        booking,
        requireString(body, 'startsAt', { maxLength: 40 }),
      );
      return ok({ status: 'confirmed', startsAt: moved.starts_at, endsAt: moved.ends_at });
    }

    throw new BookingError(`Unknown action "${action}"`, 400);
  } catch (error) {
    return handleError(error);
  }
}
