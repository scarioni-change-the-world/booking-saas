import { handleError, ok } from '@/lib/api';
import { resolveTenantMemberships } from '@/lib/auth';

/**
 * Which businesses the signed-in person belongs to.
 *
 * Called once, right after login: the browser has a session but does not yet
 * know which tenant's dashboard to open, since a URL like /admin/[slug]
 * needs the slug before it can render anything.
 */
export async function GET(request: Request) {
  try {
    const tenants = await resolveTenantMemberships(request);
    return ok({ tenants });
  } catch (error) {
    return handleError(error);
  }
}
