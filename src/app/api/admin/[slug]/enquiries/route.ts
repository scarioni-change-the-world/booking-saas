import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { listRecentResponses, loadFunnelStats } from '@/lib/qualification-response-service';
import { analyseQuestions, analyseServices } from '@/lib/enquiry-analysis';
import type { AnswerSnapshot } from '@/lib/reconsideration';
import type { EventTypeRow } from '@/lib/db/types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const LIST_LIMIT = 100;

/**
 * The figures the Enquiries section reads, in one request.
 *
 * The same 30-day window as Overview's tiles and loadFunnelStats, on
 * purpose: a page that says "8 sent elsewhere" beside a list of 8 rows and
 * a breakdown adding to 8 is a page somebody can trust. Three windows would
 * be three quietly different answers.
 *
 * Service names are resolved here rather than in the browser so the page
 * never has to hold a second list to join against — and so a service that
 * has since been archived still reads by name instead of as an id.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const sinceIso = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

    const [stats, responses, servicesResult] = await Promise.all([
      loadFunnelStats(scope, sinceIso),
      listRecentResponses(scope, sinceIso, LIST_LIMIT),
      scope.select('event_types', 'id, name'),
    ]);
    if (servicesResult.error) throw servicesResult.error;

    const names = new Map(
      ((servicesResult.data ?? []) as unknown as Pick<EventTypeRow, 'id' | 'name'>[]).map((row) => [
        row.id,
        row.name,
      ]),
    );

    /* New enquiries only.
     *
     * Both breakdowns exist to tune screening — which question turns
     * strangers away, which service converts them — and a customer of
     * three years answering again is not being screened, they are being
     * inconvenienced. Leaving them in would move the numbers the business
     * acts on for a reason that has nothing to do with the questions. */
    const analysed = responses
      .filter((r) => !r.returning)
      .map((r) => ({
        eventTypeId: r.eventTypeId,
        completedAt: r.completedAt,
        outcomePathType: r.outcomePathType,
        answers: Array.isArray(r.answers) ? (r.answers as AnswerSnapshot[]) : [],
      }));

    /* The responses themselves are not sent: the list of who answered
       lives on People now, and this page only reads the figures. */
    return ok({
      stats,
      questions: analyseQuestions(analysed),
      services: analyseServices(analysed).map((service) => ({
        ...service,
        name: service.eventTypeId
          ? (names.get(service.eventTypeId) ?? 'A service you have since removed')
          : 'A service you have since removed',
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}
