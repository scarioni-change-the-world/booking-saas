import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import type { BookingRow, CalendarConnectionRow, QualificationResponseRow } from '@/lib/db/types';

const NEXT_UP_LIMIT = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type NextUpRow = Pick<BookingRow, 'id' | 'name' | 'starts_at'> & {
  event_types: { name: string } | null;
};

/**
 * The dashboard landing page: what's coming up, how the last month of
 * screening went, and anything that needs a look.
 *
 * Every number here is a plain count over this tenant's own rows, computed
 * fresh on each load — nothing cached, nothing summarized in a background
 * job that could drift from what Bookings and Screening actually show.
 * "Needs attention" is not scoped to upcoming bookings on purpose: a failed
 * sync on a cancelled booking usually means an orphaned Google Calendar
 * event, which is still worth knowing about even though the booking itself
 * is done.
 *
 * The calendar status shown here is the last status this app itself
 * recorded, not a fresh call to Google — that live check is what the
 * Settings page's health check is for. Pinging Google on every dashboard
 * load would make the one page a tenant opens most often the slowest.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const now = new Date();
    const nowIso = now.toISOString();
    const weekAheadIso = new Date(now.getTime() + WEEK_MS).toISOString();
    const thirtyDaysAgoIso = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();

    const [upcomingResult, weekResult, failedResult, qualResult, nextUpResult, calendarResult] =
      await Promise.all([
        scope.select('bookings', 'id').eq('status', 'confirmed').gte('starts_at', nowIso),
        scope
          .select('bookings', 'id')
          .eq('status', 'confirmed')
          .gte('starts_at', nowIso)
          .lt('starts_at', weekAheadIso),
        scope.select('bookings', 'id').eq('sync_status', 'failed'),
        scope.select('qualification_responses', 'outcome').gte('created_at', thirtyDaysAgoIso),
        scope
          .select('bookings', 'id, name, starts_at, event_types(name)')
          .eq('status', 'confirmed')
          .gte('starts_at', nowIso)
          .order('starts_at', { ascending: true })
          .limit(NEXT_UP_LIMIT),
        scope.select('calendar_connections', 'status').maybeSingle(),
      ]);

    for (const result of [upcomingResult, weekResult, failedResult, qualResult, nextUpResult]) {
      if (result.error) throw result.error;
    }
    if (calendarResult.error) throw calendarResult.error;

    const qualRows = (qualResult.data ?? []) as unknown as Pick<QualificationResponseRow, 'outcome'>[];
    const qualified = qualRows.filter((r) => r.outcome === 'qualified').length;
    const redirected = qualRows.filter((r) => r.outcome === 'redirected').length;

    const nextUpRows = (nextUpResult.data ?? []) as unknown as NextUpRow[];
    const connection = calendarResult.data as unknown as Pick<CalendarConnectionRow, 'status'> | null;

    return ok({
      upcomingCount: (upcomingResult.data ?? []).length,
      thisWeekCount: (weekResult.data ?? []).length,
      needsAttentionCount: (failedResult.data ?? []).length,
      last30Days: { qualified, redirected },
      nextUp: nextUpRows.map((b) => ({
        id: b.id,
        name: b.name,
        startsAt: b.starts_at,
        eventTypeName: b.event_types?.name ?? 'Unknown session type',
      })),
      calendarStatus: connection?.status ?? 'not_connected',
    });
  } catch (error) {
    return handleError(error);
  }
}
