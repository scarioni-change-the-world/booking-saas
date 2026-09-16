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
    return ok({
      bookings: rows.map((row) => ({
        ...serializeBooking(row),
        isClient: clientEmails.has(row.email.toLowerCase()),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}
