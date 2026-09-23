import { fail, handleError, isResponse, ok, requireTenant } from '@/lib/api';
import { DEFAULT_CURRENCY } from '@/lib/money';
import { listClientEntitlements, listEventTypes, resolveClientByToken } from '@/lib/booking-service';

/**
 * Resolve a client's own private booking link.
 *
 * Same posture as a booking's manage token (brief 2.4): the token IS the
 * credential, no login, and a token that doesn't resolve gets the same 404
 * as one that resolves to nothing — this endpoint can't be used to probe
 * whether a token is real.
 *
 * Three things a client might do from here, surfaced together:
 *
 *  - spend sessions from a package they hold (entitlements)
 *  - book a one-off session outright (singleEventTypes)
 *  - buy a new package (packEventTypes)
 *
 * A pack-mode type stays out of singleEventTypes, and the reason is
 * unchanged: a pack session must be drawn from the entitlement that paid
 * for it, never booked free-standing, or somebody gets a session from a
 * package they never held.
 *
 * But that rule was doing more than it said. Written as "no pack types
 * here", it also meant a client's own link could never *sell* a package —
 * so somebody who finished a ten-session programme and wanted another had
 * no way to buy one except the public page, answering the screening
 * questions as a stranger after a year of working together. packEventTypes
 * is the same services offered as what they are: a programme to buy, which
 * books its appointments and grants its balance in one go.
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

    const [entitlements, clientEventTypes, settings] = await Promise.all([
      listClientEntitlements(scope, client.id),
      listEventTypes(scope, 'client'),
      // For a programme's published price. A tenant always has this row
      // (migration 0009's trigger); the fallback keeps a price renderable
      // rather than crashing the page if one is ever missing.
      scope.select('tenant_settings').maybeSingle(),
    ]);

    return ok({
      client: { name: client.name, email: client.email },
      currency:
        (settings.data as unknown as { currency?: string } | null)?.currency ?? DEFAULT_CURRENCY,
      entitlements,
      singleEventTypes: clientEventTypes
        .filter((t) => t.booking_mode === 'single')
        .map((t) => ({ id: t.id, name: t.name, durationMinutes: t.duration_minutes })),
      packEventTypes: clientEventTypes
        .filter((t) => t.booking_mode === 'pack' && t.pack_size)
        .map((t) => ({
          id: t.id,
          name: t.name,
          durationMinutes: t.duration_minutes,
          packSize: t.pack_size!,
          priceMinor: t.price_minor,
        })),
    });
  } catch (error) {
    return handleError(error);
  }
}
