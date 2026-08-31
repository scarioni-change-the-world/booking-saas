import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { loadFunnelStats } from '@/lib/qualification-response-service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How the intake questionnaire is doing over the last 30 days — the same
 * numbers Overview's tiles summarise, in full, for the Screening page where
 * a tenant actually acts on them: a low completion rate or a lopsided
 * meeting/other split is the signal to change a question, not just a
 * number to glance at. Both pages call loadFunnelStats so they can never
 * quietly disagree with each other.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const sinceIso = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const stats = await loadFunnelStats(scope, sinceIso);
    return ok(stats);
  } catch (error) {
    return handleError(error);
  }
}
