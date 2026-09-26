import { fail, handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { deletionBlockers, deletionKeeps } from '@/lib/service-deletion';
import { loadDeletionFacts, loadLiveService } from '@/lib/service-deletion-server';

/**
 * What deleting this service would meet: why it cannot go yet, if it
 * cannot, and what stays if it can. Read by the panel before anything is
 * typed; the DELETE on the service checks all of it again.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const service = await loadLiveService(scope, id);
    if (!service) return fail('Not found', 404);

    const facts = await loadDeletionFacts(scope, service);
    return ok({
      ...facts,
      blockers: deletionBlockers(facts, tenant.timezone),
      keeps: deletionKeeps(facts),
    });
  } catch (error) {
    return handleError(error);
  }
}
