import { fail, handleError, ok, readJson, requireString } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { aiProvider } from '@/lib/ai';
import { assertUnderMonthlyLimit, recordUsage } from '@/lib/ai/usage';
import { checkBrandColour } from '@/lib/brand-colour';
import { SiteFetchError, fetchSite } from '@/lib/site-fetch';
import { htmlToText, pagesWorthReading, siteDigest, themeColour } from '@/lib/site-text';

/**
 * "Set up from your website" (the setup wizard): read the business's own
 * site and draft its services and usual hours from it.
 *
 * POST { url }. Reads the page given and up to three pages on the same site
 * that look like services, prices or hours, every request through
 * site-fetch's public-addresses-only guard. Returns the draft and, when the
 * site declares a colour the booking page can use, that colour.
 *
 * Saves nothing. The wizard shows the draft, the business confirms what is
 * right, and the usual routes save it. Counts against a small monthly
 * allowance (ai/limits.ts) only once the assistant has answered.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);
    const address = requireString(body, 'url', { maxLength: 500 }).trim();
    const url = /^https?:\/\//i.test(address) ? address : `https://${address}`;

    await assertUnderMonthlyLimit(scope, 'site_draft');

    let home;
    try {
      home = await fetchSite(url);
    } catch (cause) {
      if (cause instanceof SiteFetchError) {
        return fail('We could not open that website. Check the address, or add your service by hand below.', 422);
      }
      throw cause;
    }

    const pages = [{ url: home.finalUrl, text: htmlToText(home.html) }];
    // The extra pages are a bonus: one that fails is skipped, not fatal.
    const extra = await Promise.all(
      pagesWorthReading(home.html, home.finalUrl).map(async (page) => {
        try {
          const site = await fetchSite(page);
          return { url: site.finalUrl, text: htmlToText(site.html) };
        } catch {
          return null;
        }
      }),
    );
    for (const page of extra) if (page && page.text) pages.push(page);

    const words = pages.reduce((n, p) => n + p.text.length, 0);
    if (words < 80) {
      // A site drawn entirely by script, or a holding page: nothing to read.
      return fail('That website has almost no text we can read. Add your service by hand below.', 422);
    }

    const draft = await aiProvider().draftFromSite({ businessName: tenant.name, siteText: siteDigest(pages) });
    await recordUsage(scope, 'site_draft');

    const declared = themeColour(home.html);
    const colour = declared ? checkBrandColour(declared) : null;

    return ok({
      draft,
      website: home.finalUrl,
      // Only a colour the booking page would accept (contrast, not Ochre).
      colour: colour?.ok ? colour.hex : null,
      pagesRead: pages.length,
    });
  } catch (error) {
    return handleError(error);
  }
}
