import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { analyseQuestions, analyseServices } from '@/lib/enquiry-analysis';
import { listRecentResponses, loadFunnelStats } from '@/lib/qualification-response-service';
import { loadSetupFacts } from '@/lib/setup-facts';
import { DEFAULT_CURRENCY } from '@/lib/money';
import type { AnswerSnapshot } from '@/lib/reconsideration';
import type { BookingStatus, CalendarConnectionRow, TenantSettingsRow } from '@/lib/db/types';
import type { FlowInput } from '@/lib/flow';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RESPONSE_LIMIT = 1000;
const BOOKING_LIMIT = 2000;
/** Per service; read six times over so each service's panel has its own. */
const NEXT_UP_LIMIT = 5;
/** A client record made this close to a booking is that booking's own. */
const SAME_MOMENT_MS = 5 * 60 * 1000;

interface BookingJoin {
  event_type_id: string;
  status: BookingStatus;
  created_at: string;
  clients: { created_at: string } | null;
}

interface NextUpJoin {
  id: string;
  name: string;
  email: string;
  starts_at: string;
  event_type_id: string;
  event_types: { name: string } | null;
}

/**
 * Everything Flow draws, in one request: the pipeline's parts and the last
 * 30 days moving through them. What Overview and the Enquiries analysis
 * each showed, gathered onto the parts they measure.
 *
 * The same 30-day window and the same counting functions as Overview,
 * Enquiries and People used, so a number on a line here can be checked
 * against the list it opens.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const sinceIso = new Date(now - THIRTY_DAYS_MS).toISOString();
    const weekAheadIso = new Date(now + WEEK_MS).toISOString();

    const [facts, funnel, responses, bookings, nextUp, weekAhead, failedSync, failedEmail, calendar, clients, settings] =
      await Promise.all([
        loadSetupFacts(scope),
        loadFunnelStats(scope, sinceIso),
        listRecentResponses(scope, sinceIso, RESPONSE_LIMIT),
        scope
          .select('bookings', 'event_type_id, status, created_at, clients(created_at)')
          .gte('created_at', sinceIso)
          .limit(BOOKING_LIMIT),
        scope
          .select('bookings', 'id, name, email, starts_at, event_type_id, event_types(name)')
          .eq('status', 'confirmed')
          .gte('starts_at', nowIso)
          .order('starts_at', { ascending: true })
          .limit(NEXT_UP_LIMIT * 6),
        scope.select('bookings', 'id').eq('status', 'confirmed').gte('starts_at', nowIso).lt('starts_at', weekAheadIso),
        scope.select('bookings', 'id').eq('sync_status', 'failed'),
        scope.select('email_sends', 'id').eq('status', 'failed').gte('created_at', sinceIso),
        scope.select('calendar_connections', 'status').maybeSingle(),
        scope.select('clients', 'id'),
        scope.select('tenant_settings').maybeSingle(),
      ]);
    for (const result of [bookings, nextUp, weekAhead, failedSync, calendar, clients, settings]) {
      if (result.error) throw result.error;
    }

    /* The analysis is of new enquiries only, as on Enquiries: somebody who
       already works with you answering again is not being screened. */
    const analysed = responses
      .filter((r) => !r.returning)
      .map((r) => ({
        eventTypeId: r.eventTypeId,
        completedAt: r.completedAt,
        outcomePathType: r.outcomePathType,
        answers: Array.isArray(r.answers) ? (r.answers as AnswerSnapshot[]) : [],
      }));

    const input: FlowInput = {
      tenant: {
        slug: tenant.slug,
        name: tenant.name,
        currency: (settings.data as unknown as TenantSettingsRow | null)?.currency ?? DEFAULT_CURRENCY,
      },
      funnel,
      globalQuestionCount: facts.globalQuestionCount,
      availabilityRuleCount: facts.availabilityRuleCount,
      hasOtherPathMessage: facts.hasOtherPathMessage,
      hasOtherPathUrl: facts.hasOtherPathUrl,
      otherPathLabel: facts.otherPathLabel,
      services: facts.services,
      /* Per service, because each service's flow has its own questions:
         the shared ones and any it asks of its own. */
      questionInsightsByService: Object.fromEntries(
        facts.services.map((svc) => [
          svc.id,
          analyseQuestions(analysed.filter((r) => r.eventTypeId === svc.id)),
        ]),
      ),
      serviceInsights: analyseServices(analysed),
      bookings: ((bookings.data ?? []) as unknown as BookingJoin[]).map((b) => ({
        eventTypeId: b.event_type_id,
        status: b.status,
        byExistingClient:
          !!b.clients && new Date(b.clients.created_at).getTime() < new Date(b.created_at).getTime() - SAME_MOMENT_MS,
      })),
      weeklyMinutes: facts.weeklyMinutes,
      calendarStatus:
        (calendar.data as unknown as Pick<CalendarConnectionRow, 'status'> | null)?.status ?? 'not_connected',
      syncFailures: (failedSync.data ?? []).length,
      /* Read on its own so a database without migration 0027 still draws
         the flow, just without this one flag. */
      emailFailures: failedEmail.error ? 0 : (failedEmail.data ?? []).length,
      clientCount: (clients.data ?? []).length,
    };

    return ok({
      ...input,
      timezone: tenant.timezone,
      thisWeekCount: (weekAhead.data ?? []).length,
      nextUp: ((nextUp.data ?? []) as unknown as NextUpJoin[]).map((b) => ({
        id: b.id,
        name: b.name,
        email: b.email,
        startsAt: b.starts_at,
        eventTypeId: b.event_type_id,
        eventTypeName: b.event_types?.name ?? 'A service you have since removed',
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}
