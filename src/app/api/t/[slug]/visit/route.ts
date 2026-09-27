import { handleError, isResponse, ok, readJson, requireTenant } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isTestRun } from '@/lib/test-run-server';
import { cleanSource } from '@/lib/visit-source';

const SURFACES = new Set(['page', 'embedded', 'client_link']);

/**
 * Count one visit to a booking page: a time and a source label, nothing
 * that identifies anybody (see migration 0033). A business's own test run
 * is not a visit. Limited per caller, so a reload loop cannot inflate the
 * count much, and answers the same whatever happens — the page never waits
 * on this.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;
    if (await isTestRun(request, slug)) return ok({ counted: false });

    const body = await readJson(request);
    const surface = typeof body.surface === 'string' && SURFACES.has(body.surface) ? body.surface : 'page';
    const source = cleanSource(body.source) ?? 'direct';

    await enforceRateLimit(request, resolved.tenant.id, 'pageVisit');
    const { error } = await resolved.scope.insert('page_visits', { source, surface: surface as 'page' });
    // Before migration 0033 there is nowhere to count it; that is not the visitor's problem.
    if (error && error.code !== '42P01' && error.code !== 'PGRST205') throw error;
    return ok({ counted: !error });
  } catch (error) {
    return handleError(error);
  }
}
