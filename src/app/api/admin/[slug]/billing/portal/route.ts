import { fail, handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { baseUrl } from '@/lib/base-url';
import { stripe, stripeConfigured } from '@/lib/stripe';

/**
 * Stripe's own billing page for this business: change the card, see and
 * download invoices, cancel. Open while locked out, so a business whose card
 * failed can fix it.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant } = await requireTenantAdmin(request, slug, {
      allowGated: true,
    });
    if (!stripeConfigured()) return fail('Billing is not set up yet.', 503);
    if (!tenant.stripe_customer_id) return fail('There is no subscription to manage yet.', 404);

    const session = await stripe().billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: `${baseUrl()}/admin/${encodeURIComponent(slug)}/account`,
    });
    return ok({ url: session.url });
  } catch (error) {
    return handleError(error);
  }
}
