import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { detectBuilder } from '@/lib/builders';
import { fetchSite } from '@/lib/site-fetch';

/**
 * Which tool the business's website is made with (Squarespace, Wix…), so
 * Share can show only that tool's steps. Reads the website saved in
 * Account; answers null when it cannot tell or cannot reach the site, and
 * Share then lets the person pick.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant } = await requireTenantAdmin(request, slug);
    const website = tenant.branding?.websiteUrl;
    if (!website) return ok({ builder: null });
    try {
      const site = await fetchSite(website);
      return ok({ builder: detectBuilder(site.html, site.headers) });
    } catch {
      return ok({ builder: null });
    }
  } catch (error) {
    return handleError(error);
  }
}
