import { fail, handleError, ok } from '@/lib/api';
import { requirePlatformStaff } from '@/lib/auth';
import { getTenantById } from '@/lib/db/console';
import { businessDeletionBlockers, businessDeletionSteps } from '@/lib/business-deletion';
import { loadBusinessDeletionFacts } from '@/lib/business-deletion-server';

/**
 * What deleting this business would do, or why it cannot be deleted yet:
 * for the console panel, before anything is typed. Any staff member may
 * look; only an owner is told it can go ahead (the DELETE checks again).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const staff = await requirePlatformStaff(request);
    const tenant = await getTenantById(id);
    if (!tenant) return fail('Not found', 404);

    const facts = await loadBusinessDeletionFacts(tenant);
    return ok({
      slug: tenant.slug,
      blockers: businessDeletionBlockers(facts, staff.role),
      steps: businessDeletionSteps(facts, tenant.timezone),
    });
  } catch (error) {
    return handleError(error);
  }
}
