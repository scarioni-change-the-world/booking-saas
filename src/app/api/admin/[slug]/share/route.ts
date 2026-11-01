import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { tenantEmbedDomains } from '@/lib/db/tenants';
import { allowedFrameHosts, hostAllowed, websiteFrameHosts } from '@/lib/embed';

export interface ShareSighting {
  host: string;
  pageUrl: string;
  ok: boolean;
  seenAt: string;
  /** Whether the host is on the allowed list now (it may have been added since). */
  allowed: boolean;
}

/**
 * Everything Share shows besides the services: the website, the sites
 * allowed to show the booking page, and where the code has been seen
 * (embed.js → /api/t/[slug]/embed-check), newest first.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const website = tenant.branding?.websiteUrl ?? null;
    const domains = await tenantEmbedDomains(tenant.id);
    const allowed = allowedFrameHosts(domains, website);

    const { data, error } = await scope
      .select('embed_sightings', 'host,page_url,ok,seen_at')
      .order('seen_at', { ascending: false })
      .limit(20);
    // Before migration 0034 nothing has been seen, which is true enough.
    if (error && error.code !== '42P01' && error.code !== 'PGRST205') throw error;
    const rows = (data ?? []) as unknown as Array<{ host: string; page_url: string; ok: boolean; seen_at: string }>;

    const sightings: ShareSighting[] = rows.map((r) => ({
      host: r.host,
      pageUrl: r.page_url,
      ok: r.ok,
      seenAt: r.seen_at,
      allowed: hostAllowed(r.host, allowed),
    }));

    return ok({
      website,
      domains,
      fromWebsite: websiteFrameHosts(website),
      sightings,
      tracking: !error,
    });
  } catch (error) {
    return handleError(error);
  }
}
