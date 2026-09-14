import { fail, handleError, isResponse, ok, requireTenant } from '@/lib/api';
import { listClientEntitlements, listEventTypes, resolveClientByToken } from '@/lib/booking-service';

/**
 * Resolve a client's own private booking link.
 *
 * Same posture as a booking's manage token (brief 2.4): the token IS the
 * credential, no login, and a token that doesn't resolve gets the same 404
 * as one that resolves to nothing — this endpoint can't be used to probe
 * whether a token is real.
 *
 * Two different things a client might do from here, both surfaced together:
 * redeem sessions from a package (entitlements), or book a one-off session
 * outright (singleEventTypes — booking_mode 'single' and flagged
 * available_to_existing_clients). A pack-mode type is deliberately excluded
 * from singleEventTypes: it must be booked through the entitlement it draws
 * down (.../bookings below), never as a free-standing booking, or a
 * client could book a "pack" session without ever holding a package for it.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ slug: string; token: string }> },
) {
  try {
    const { slug, token } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { scope } = resolved;
    const client = await resolveClientByToken(scope, token);
    if (!client) return fail('Not found', 404);

    const [entitlements, clientEventTypes] = await Promise.all([
      listClientEntitlements(scope, client.id),
      listEventTypes(scope, 'client'),
    ]);

    return ok({
      client: { name: client.name, email: client.email },
      entitlements,
      singleEventTypes: clientEventTypes
        .filter((t) => t.booking_mode === 'single')
        .map((t) => ({ id: t.id, name: t.name, durationMinutes: t.duration_minutes })),
    });
  } catch (error) {
    return handleError(error);
  }
}
