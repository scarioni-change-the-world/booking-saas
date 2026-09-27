import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { updateTenantBilling } from '@/lib/db/billing';
import { stripe, stripeConfigured } from '@/lib/stripe';

/**
 * Ask Stripe where the business's account stands, and keep the answer —
 * called when they come back from Stripe's onboarding, before its webhook
 * (account.updated) may have arrived.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant } = await requireTenantAdmin(request, slug);
    if (!stripeConfigured() || !tenant.stripe_account_id) {
      return ok({
        connected: false,
        chargesEnabled: false,
        detailsSubmitted: false,
      });
    }
    const account = await stripe().accounts.retrieve(tenant.stripe_account_id);
    const chargesEnabled = !!account.charges_enabled;
    if (chargesEnabled !== !!tenant.stripe_charges_enabled) {
      await updateTenantBilling(tenant.id, {
        stripe_charges_enabled: chargesEnabled,
      });
    }
    return ok({
      connected: true,
      chargesEnabled,
      detailsSubmitted: !!account.details_submitted,
    });
  } catch (error) {
    return handleError(error);
  }
}
