import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeBooking, type BookingWithJoins } from '@/lib/admin-serializers';
import { BookingError } from '@/lib/booking-service';

const EMBED = '*, event_types(name), qualification_responses(answers, outcome_path_type)';

/**
 * The three lists a tenant actually wants to look at, kept mutually
 * exclusive so a booking never shows up twice across tabs:
 *
 *   upcoming  — confirmed, still ahead of now, soonest first
 *   past      — confirmed, already happened, most recent first
 *   cancelled — cancelled at any time, most recently cancelled first
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const url = new URL(request.url);
    const view = url.searchParams.get('view') ?? 'upcoming';
    if (view !== 'upcoming' && view !== 'past' && view !== 'cancelled') {
      throw new BookingError('"view" must be upcoming, past, or cancelled', 400);
    }

    const nowIso = new Date().toISOString();
    const base = scope.select('bookings', EMBED);

    const { data, error } =
      view === 'upcoming'
        ? await base.eq('status', 'confirmed').gte('starts_at', nowIso).order('starts_at', { ascending: true })
        : view === 'past'
          ? await base.eq('status', 'confirmed').lt('starts_at', nowIso).order('starts_at', { ascending: false })
          : await base.eq('status', 'cancelled').order('starts_at', { ascending: false });

    if (error) throw error;

    // Who already has a client record, so the list can offer "add as client"
    // only where it means something. By email rather than bookings.client_id:
    // that column is only set when the booking was *made* through a client's
    // own link, so a prospect who booked first and was promoted afterwards
    // would still read as a stranger. One small query for the whole page —
    // emails only, deliberately not the client rows themselves, which carry
    // the access tokens this page has no use for.
    const clientsResult = await scope.select('clients', 'email');
    if (clientsResult.error) throw clientsResult.error;

    const clientEmails = new Set(
      ((clientsResult.data ?? []) as unknown as Array<{ email: string }>).map((c) =>
        c.email.toLowerCase(),
      ),
    );

    const rows = (data ?? []) as unknown as BookingWithJoins[];

    /* Which programme each booking belongs to, and where that programme
       stands.
       
       Two queries for the whole page rather than one per booking: the list
       is a hundred rows on a busy week, and a per-row lookup would be a
       hundred round trips to answer a question about a handful of
       programmes. The list itself stays in date order — a business scans it
       by day, and pulling a programme's three appointments together would
       take two of them out of the order they are looked for in. */
    const packs = await programmeStandings(scope, rows);

    return ok({
      bookings: rows.map((row) => ({
        ...serializeBooking(row),
        isClient: clientEmails.has(row.email.toLowerCase()),
        pack: row.pack_id ? (packs.get(row.pack_id) ?? null) : null,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

interface ProgrammeStanding {
  size: number;
  booked: number;
  remaining: number;
}

/**
 * Where each programme on this page stands, keyed by pack id.
 *
 * `remaining` comes from the client's balance when the programme has one,
 * exactly as it does on the client's own manage page — one answer to "how
 * many are still owed", so the two sides of the product cannot disagree. A
 * programme booked before packs and balances were joined up has no grant to
 * read, and falls back to counting its own confirmed appointments.
 */
async function programmeStandings(
  scope: Awaited<ReturnType<typeof requireTenantAdmin>>['scope'],
  rows: BookingWithJoins[],
): Promise<Map<string, ProgrammeStanding>> {
  const packIds = [...new Set(rows.map((row) => row.pack_id).filter((id): id is string => !!id))];
  if (packIds.length === 0) return new Map();

  const { data, error } = await scope
    .select('bookings', 'pack_id, pack_size, status, entitlement_id')
    .in('pack_id', packIds);
  if (error) throw error;

  const members = (data ?? []) as unknown as Array<
    Pick<BookingWithJoins, 'pack_id' | 'pack_size' | 'status' | 'entitlement_id'>
  >;

  const entitlementIds = [
    ...new Set(members.map((m) => m.entitlement_id).filter((id): id is string => !!id)),
  ];

  const balances = new Map<string, number>();
  if (entitlementIds.length > 0) {
    const grants = await scope
      .select('client_entitlements', 'id, total_sessions, used_sessions')
      .in('id', entitlementIds);
    if (grants.error) throw grants.error;

    for (const grant of (grants.data ?? []) as unknown as Array<{
      id: string;
      total_sessions: number;
      used_sessions: number;
    }>) {
      balances.set(grant.id, Math.max(0, grant.total_sessions - grant.used_sessions));
    }
  }

  const standings = new Map<string, ProgrammeStanding>();
  for (const packId of packIds) {
    const own = members.filter((m) => m.pack_id === packId);
    if (own.length === 0) continue;

    const size = own[0]!.pack_size ?? own.length;
    const booked = own.filter((m) => m.status === 'confirmed').length;
    const entitlementId = own.find((m) => m.entitlement_id)?.entitlement_id ?? null;
    const remaining =
      entitlementId && balances.has(entitlementId)
        ? balances.get(entitlementId)!
        : Math.max(0, size - booked);

    standings.set(packId, { size, booked, remaining });
  }

  return standings;
}
