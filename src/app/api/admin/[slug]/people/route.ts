import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { loadClients } from '@/lib/client-list';
import { serviceColour } from '@/lib/service-identity';
import { listRecentResponses } from '@/lib/qualification-response-service';
import type { BookingStatus, EventTypeRow } from '@/lib/db/types';
import type { PeopleAnswer, PeopleBooking, PeopleResponse } from '@/lib/people';

/** A year: long enough to see somebody come back, short enough to stay one request. */
const WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const RESPONSE_LIMIT = 1000;
const BOOKING_LIMIT = 2000;

interface BookingJoin {
  id: string;
  name: string;
  email: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
  status: BookingStatus;
  pack_id: string | null;
  pack_size: number | null;
  event_types: { name: string; color: string | null } | null;
}

/**
 * Everything People folds together: every client, and the last year of
 * bookings and answers. The folding itself happens in the browser with
 * src/lib/people.ts, so "now" is the viewer's now and the rules have one
 * home that the tests read too.
 *
 * Every client, not a year of them: somebody who has been a customer for
 * three years and has not booked since spring is still somebody the
 * business knows, and exactly who they come here to find.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);

    const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

    const [clients, responses, bookingsResult, servicesResult] = await Promise.all([
      loadClients(scope),
      listRecentResponses(scope, windowStart, RESPONSE_LIMIT),
      scope
        .select(
          'bookings',
          'id, name, email, starts_at, ends_at, created_at, status, pack_id, pack_size, event_types(name, color)',
        )
        .gte('starts_at', windowStart)
        .order('created_at', { ascending: false })
        .limit(BOOKING_LIMIT),
      scope.select('event_types', 'id, name'),
    ]);
    if (bookingsResult.error) throw bookingsResult.error;
    if (servicesResult.error) throw servicesResult.error;

    const names = new Map(
      ((servicesResult.data ?? []) as unknown as Pick<EventTypeRow, 'id' | 'name'>[]).map((row) => [
        row.id,
        row.name,
      ]),
    );

    const bookings: PeopleBooking[] = ((bookingsResult.data ?? []) as unknown as BookingJoin[]).map((b) => ({
      id: b.id,
      name: b.name,
      email: b.email,
      eventTypeName: b.event_types?.name ?? 'A service you have since removed',
      eventTypeColor: serviceColour(b.event_types?.color),
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      createdAt: b.created_at,
      status: b.status,
      packId: b.pack_id,
      packSize: b.pack_size,
    }));

    const peopleResponses: PeopleResponse[] = responses.map((r) => ({
      id: r.id,
      email: r.email,
      serviceName: r.eventTypeId ? (names.get(r.eventTypeId) ?? null) : null,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      outcomePathType: r.outcomePathType,
      answers: Array.isArray(r.answers) ? (r.answers as PeopleAnswer[]) : [],
      reconsidered: r.reconsidered,
      returning: r.returning,
    }));

    return ok({
      timezone: tenant.timezone,
      windowStart,
      clients,
      bookings,
      responses: peopleResponses,
    });
  } catch (error) {
    return handleError(error);
  }
}
