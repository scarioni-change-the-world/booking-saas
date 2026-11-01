import { handleError, ok, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { BookingError } from '@/lib/booking-service';
import { replaceTenantEmbedDomains, tenantEmbedDomains } from '@/lib/db/tenants';
import { MAX_EMBED_DOMAINS, normaliseEmbedDomain, websiteFrameHosts } from '@/lib/embed';
import { fetchSite } from '@/lib/site-fetch';

/**
 * Share's "Allow it": add a site the code was seen on to the allowed list.
 *
 * A sighting is a report anyone could have sent, so it is not taken on
 * trust. The site is added only when it is part of the business's own
 * website's domain, or when its page, fetched from here, really carries
 * this business's code. Otherwise the answer says so, and the person can
 * still add it by hand under "Other sites" if it is theirs.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);
    const host = typeof body.host === 'string' ? normaliseEmbedDomain(body.host) : null;
    if (!host || host.startsWith('*.')) throw new BookingError('That is not a site address', 400);

    const { data, error } = await scope.select('embed_sightings', 'host,page_url').eq('host', host).maybeSingle();
    if (error) throw error;
    const sighting = data as unknown as { host: string; page_url: string } | null;
    if (!sighting) throw new BookingError('Your booking page has not been seen on that site', 404);

    const own = websiteFrameHosts(tenant.branding?.websiteUrl).map((h) => h.replace(/^www\./, ''));
    const underWebsite = own.some((root) => host === root || host.endsWith(`.${root}`));

    if (!underWebsite) {
      let found = false;
      try {
        const page = await fetchSite(sighting.page_url);
        found = page.html.includes(`/t/${slug}`);
      } catch {
        found = false;
      }
      if (!found) {
        return ok({
          allowed: false,
          message: `We couldn’t find your code on ${sighting.page_url} to confirm it. If ${host} is your site, add it under “Other sites”.`,
        });
      }
    }

    const domains = await tenantEmbedDomains(tenant.id);
    if (!domains.includes(host)) {
      if (domains.length >= MAX_EMBED_DOMAINS) {
        throw new BookingError(`You can allow up to ${MAX_EMBED_DOMAINS} other sites. Remove one under “Other sites” first.`, 400);
      }
      await replaceTenantEmbedDomains(tenant.id, [...domains, host]);
    }
    return ok({ allowed: true });
  } catch (error) {
    return handleError(error);
  }
}
