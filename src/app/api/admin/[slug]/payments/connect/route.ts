import { fail, handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { baseUrl } from '@/lib/base-url';
import { updateTenantBilling } from '@/lib/db/billing';
import { stripe, stripeConfigured } from '@/lib/stripe';

/**
 * Link the business's own Stripe account, so its clients can pay it.
 *
 * A Standard account: the business owns it, logs into Stripe directly, sees
 * every payment and refund there, and is the seller in law. intro only asks
 * Stripe to take payments on its behalf, and takes no cut. Stripe's own
 * onboarding collects who they are and where the money goes; this returns
 * its address. Calling it again for a half-finished account picks up where
 * they left off.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, userEmail } = await requireTenantAdmin(request, slug);
    if (!stripeConfigured())
      return fail('Taking payments is not set up yet. Get in touch and we will sort it.', 503);

    let account = tenant.stripe_account_id ?? null;
    if (!account) {
      const created = await stripe().accounts.create({
        type: 'standard',
        email: userEmail ?? undefined,
        business_profile: { name: tenant.name },
        metadata: { tenant_id: tenant.id, slug: tenant.slug },
      });
      account = created.id;
      await updateTenantBilling(tenant.id, {
        stripe_account_id: account,
        stripe_charges_enabled: !!created.charges_enabled,
      });
    }

    const back = `${baseUrl()}/admin/${encodeURIComponent(slug)}/account`;
    const link = await stripe().accountLinks.create({
      account,
      type: 'account_onboarding',
      refresh_url: `${back}?stripe=again`,
      return_url: `${back}?stripe=back`,
    });
    return ok({ url: link.url });
  } catch (error) {
    return handleError(error);
  }
}
