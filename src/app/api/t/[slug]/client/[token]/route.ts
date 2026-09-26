import { fail, handleError, isResponse, ok, requireTenant } from '@/lib/api';
import { DEFAULT_CURRENCY } from '@/lib/money';
import { listClientEntitlements, listEventTypes, resolveClientByToken } from '@/lib/booking-service';
import type { TenantScope } from '@/lib/db';
import type { BookingRow } from '@/lib/db/types';
import type { HistoryBooking } from '@/lib/client-thread';
import { exactPattern } from '@/lib/like';

const HISTORY_LIMIT = 100;

interface HistoryJoin extends Pick<BookingRow, 'id' | 'starts_at' | 'ends_at' | 'status' | 'pack_id' | 'pack_size' | 'manage_token'> {
  event_types: { name: string } | null;
}

/**
 * Everything this client has booked with the business, for the thread at
 * the top of their link (src/lib/client-thread.ts).
 *
 * By their client record and by their address, because a booking made
 * before they had a record carries only the address — and it is still
 * theirs. The token already proves who they are; this shows them their own
 * appointments and nobody else's.
 *
 * A manage link only for what is still to come: the one thing worth doing
 * with a past appointment is remembering it.
 */
async function clientHistory(scope: TenantScope, clientId: string, email: string): Promise<HistoryBooking[]> {
  const columns = 'id, starts_at, ends_at, status, pack_id, pack_size, manage_token, event_types(name)';
  const [byRecord, byAddress] = await Promise.all([
    scope.select('bookings', columns).eq('client_id', clientId).order('starts_at', { ascending: false }).limit(HISTORY_LIMIT),
    scope.select('bookings', columns).ilike('email', exactPattern(email)).order('starts_at', { ascending: false }).limit(HISTORY_LIMIT),
  ]);
  if (byRecord.error) throw byRecord.error;
  if (byAddress.error) throw byAddress.error;

  const rows = new Map<string, HistoryJoin>();
  for (const row of [...((byRecord.data ?? []) as unknown as HistoryJoin[]), ...((byAddress.data ?? []) as unknown as HistoryJoin[])]) {
    rows.set(row.id, row);
  }
  const now = new Date().toISOString();
  return [...rows.values()].map((row) => ({
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    eventTypeName: row.event_types?.name ?? 'A session',
    packId: row.pack_id,
    packSize: row.pack_size,
    manageToken: row.status === 'confirmed' && row.ends_at > now ? row.manage_token : null,
  }));
}

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

    const { scope, tenant } = resolved;
    const client = await resolveClientByToken(scope, token);
    if (!client) return fail('Not found', 404);

    const [entitlements, clientEventTypes, settings, history] = await Promise.all([
      listClientEntitlements(scope, client.id),
      listEventTypes(scope, 'client'),
      // For a programme's published price. A tenant always has this row
      // (migration 0009's trigger); the fallback keeps a price renderable
      // rather than crashing the page if one is ever missing.
      scope.select('tenant_settings').maybeSingle(),
      clientHistory(scope, client.id, client.email),
    ]);

    return ok({
      client: { name: client.name, email: client.email, since: client.created_at },
      business: tenant.name,
      branding: tenant.branding ?? {},
      history,
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
