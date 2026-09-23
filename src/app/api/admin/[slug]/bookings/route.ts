import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeBooking, type BookingWithJoins } from '@/lib/admin-serializers';
import { BookingError } from '@/lib/booking-service';
import { asAttempt } from '@/lib/qualification-response-service';
import { findReconsideration, type Reconsideration } from '@/lib/reconsideration';
import type { QualificationResponseRow } from '@/lib/db/types';

const EMBED =
  '*, event_types(name), qualification_responses(id, email, event_type_id, completed_at, answers, outcome_path_type)';

/**
 * The three lists a tenant actually wants to look at, kept mutually
 * exclusive so a booking never shows up twice across tabs:
 *
 *   upcoming  — confirmed, still ahead of now, soonest first
 *   past      — confirmed, already happened, most recent first
 *   cancelled — cancelled at any time, most recently cancelled first
 *
 * And a fourth, for the Week: `range`, confirmed bookings starting between
 * `from` and `to`, in time order. Confirmed only — a cancelled appointment
 * no longer occupies the hour, and drawing it on the grid would make a
 * free slot look taken. The cancelled list is still one click away.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const url = new URL(request.url);
    const view = url.searchParams.get('view') ?? 'upcoming';
    if (view !== 'upcoming' && view !== 'past' && view !== 'cancelled' && view !== 'range') {
      throw new BookingError('"view" must be upcoming, past, cancelled, or range', 400);
    }

    const nowIso = new Date().toISOString();
    const base = scope.select('bookings', EMBED);

    let range: { from: string; to: string } | null = null;
    if (view === 'range') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
        throw new BookingError('A range needs "from" and "to" as dates and times', 400);
      }
      // A week is the widest thing anything asks for; this bounds the query
      // so a hand-typed URL cannot ask for ten years of bookings at once.
      if (Date.parse(to) - Date.parse(from) > 45 * 24 * 60 * 60 * 1000) {
        throw new BookingError('A range can be at most 45 days', 400);
      }
      range = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
    }

    const { data, error } = range
      ? await base
          .eq('status', 'confirmed')
          .gte('starts_at', range.from)
          .lt('starts_at', range.to)
          .order('starts_at', { ascending: true })
      : view === 'upcoming'
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

    /* Which of these bookings were made on a second attempt, after the
       person had already been sent elsewhere. Surfaced here as well as on
       Enquiries because this is the list where it matters most: a booking
       in the diary is a commitment, and the business deserves to know it
       was made by somebody who had been turned away an hour earlier. */
    const reconsiderations = await reconsiderationsFor(scope, rows);

    return ok({
      bookings: rows.map((row) => ({
        ...serializeBooking(row),
        isClient: clientEmails.has(row.email.toLowerCase()),
        pack: row.pack_id ? (packs.get(row.pack_id) ?? null) : null,
        reconsidered: reconsiderations.get(row.id) ?? null,
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
  /**
   * Sessions this client was already owed when they bought this programme,
   * or null when they owed nothing — which is almost always.
   *
   * A property of the programme rather than of one appointment in it: it is
   * written once, on the first booking of the pack (migration 0026), but a
   * business scanning their diary by date meets whichever appointment falls
   * next, and a flag they can only see on one row of three is a flag they
   * will miss.
   */
  priorSessionsOwed: number | null;
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
    .select('bookings', 'pack_id, pack_size, status, entitlement_id, prior_sessions_owed')
    .in('pack_id', packIds);
  if (error) throw error;

  const members = (data ?? []) as unknown as Array<
    Pick<
      BookingWithJoins,
      'pack_id' | 'pack_size' | 'status' | 'entitlement_id' | 'prior_sessions_owed'
    >
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

    const priorSessionsOwed =
      own.find((m) => m.prior_sessions_owed !== null)?.prior_sessions_owed ?? null;

    standings.set(packId, { size, booked, remaining, priorSessionsOwed });
  }

  return standings;
}

/**
 * The bookings on this page that were made on a second attempt, keyed by
 * booking id.
 *
 * One history query for the whole page — see historyFor's reasoning in
 * qualification-response-service.ts. A booking with no questionnaire behind
 * it simply is not in the map.
 */
async function reconsiderationsFor(
  scope: Awaited<ReturnType<typeof requireTenantAdmin>>['scope'],
  rows: BookingWithJoins[],
): Promise<Map<string, Reconsideration>> {
  const withResponses = rows.filter((row) => row.qualification_responses);
  if (withResponses.length === 0) return new Map();

  const emails = [
    ...new Set(
      withResponses
        .map((row) => row.qualification_responses!.email)
        .filter((email): email is string => !!email),
    ),
  ];
  if (emails.length === 0) return new Map();

  const { data, error } = await scope
    .select('qualification_responses')
    .in('email', emails)
    .not('completed_at', 'is', null);
  if (error) throw error;

  const history = ((data ?? []) as unknown as QualificationResponseRow[]).map(asAttempt);

  const found = new Map<string, Reconsideration>();
  for (const row of withResponses) {
    const response = row.qualification_responses!;
    const reconsidered = findReconsideration(
      {
        id: response.id,
        email: response.email,
        eventTypeId: response.event_type_id,
        completedAt: response.completed_at,
        outcomePathType: response.outcome_path_type,
        answers: Array.isArray(response.answers) ? response.answers : [],
      },
      history,
    );
    if (reconsidered) found.set(row.id, reconsidered);
  }

  return found;
}
