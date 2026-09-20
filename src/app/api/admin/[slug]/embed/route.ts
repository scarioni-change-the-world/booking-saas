import { handleError, ok, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { BookingError } from '@/lib/booking-service';
import { replaceTenantEmbedDomains, tenantEmbedDomains } from '@/lib/db/tenants';
import { MAX_EMBED_DOMAINS, normaliseEmbedDomains } from '@/lib/embed';

/**
 * Which sites may frame this tenant's booking widget.
 *
 * Its own route rather than a field on .../settings because it writes to a
 * different table — embed_domains lives on `tenants`, not `tenant_settings`
 * — and because it is the one setting in this product that is a security
 * policy. Every value here is served inside a Content-Security-Policy header
 * to every visitor of that tenant's page, so it is worth the separation:
 * changing a notice period and changing who may frame your booking form are
 * not the same kind of act.
 *
 * Admin only, like every other setting.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant } = await requireTenantAdmin(request, slug);
    return ok({ domains: await tenantEmbedDomains(tenant.id) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Replace the list outright rather than patching it.
 *
 * The interface edits the whole set at once, and a partial update of a
 * security allowlist is a shape worth not having: "add this one" and
 * "remove that one" racing each other can leave a domain allowed that
 * somebody believed they had removed.
 */
export async function PUT(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant } = await requireTenantAdmin(request, slug);

    const body = await readJson(request);
    const submitted = body.domains;
    if (!Array.isArray(submitted) || submitted.some((d) => typeof d !== 'string')) {
      throw new BookingError('Expected "domains" to be a list of hostnames', 400);
    }
    if (submitted.length > MAX_EMBED_DOMAINS * 4) {
      throw new BookingError('Too many entries to check', 400);
    }

    const { domains, rejected } = normaliseEmbedDomains(submitted as string[]);

    // Saved anyway, with the rejects named. Refusing the whole save because
    // one line has a typo would lose the other nine, and the caller can see
    // exactly which one did not make it.
    const saved = await replaceTenantEmbedDomains(tenant.id, domains);
    return ok({ domains: saved, rejected });
  } catch (error) {
    return handleError(error);
  }
}
