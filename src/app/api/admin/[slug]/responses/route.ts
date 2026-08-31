import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { listRecentResponses } from '@/lib/qualification-response-service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const LIST_LIMIT = 100;

/**
 * The people behind /funnel's numbers — the Responses tab's list, not just
 * its stats tiles. Same 30-day window as /funnel and the Overview tile, so
 * "8 aligned" and the 8 rows shown here can never quietly disagree.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const sinceIso = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const responses = await listRecentResponses(scope, sinceIso, LIST_LIMIT);
    return ok({ responses });
  } catch (error) {
    return handleError(error);
  }
}
