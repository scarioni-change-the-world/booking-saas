import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';

/**
 * Confirms the signed-in person may administer this specific tenant, and
 * hands back enough to render the dashboard shell without a second call.
 *
 * The dashboard layout calls this once on load. A 401/403/404 here is what
 * sends the browser back to the login page rather than rendering a shell for
 * a business the caller cannot actually touch.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, role } = await requireTenantAdmin(request, slug);
    return ok({ name: tenant.name, slug: tenant.slug, role });
  } catch (error) {
    return handleError(error);
  }
}
