import { fail, handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { baseUrl } from '@/lib/base-url';
import { updateTenantBilling } from '@/lib/db/billing';
import { automaticTax, stripe, stripeConfigured, subscriptionPriceId } from '@/lib/stripe';
import { canStartSubscription, subscriptionToReplace } from '@/lib/subscription';

/**
 * Start paying intro: a Stripe Checkout page for the €7 subscription.
 *
 * Open while a business is locked out after its trial (allowGated) — paying
 * is the one thing it must still be able to do. A business still inside its
 * trial is not charged until the trial ends: the days it has left carry into
 * the subscription as Stripe's own trial. Stripe needs a trial to end at
 * least two days ahead, so a trial with less left starts billing at once.
 *
 * What the subscription does to the account arrives by webhook
 * (/api/stripe/webhook), not from the redirect back here, which a closed tab
 * never makes.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, userEmail } = await requireTenantAdmin(request, slug, {
      allowGated: true,
    });

    const price = subscriptionPriceId();
    if (!stripeConfigured() || !price)
      return fail('Paying online is not set up yet. Get in touch and we will sort it.', 503);
    if (tenant.stripe_subscription_id && !canStartSubscription(tenant.subscription_status)) {
      return fail('You already have a subscription. Manage it from “Manage billing”.', 409);
    }
    if (tenant.stripe_subscription_id && subscriptionToReplace(tenant.subscription_status)) {
      await stripe()
        .subscriptions.cancel(tenant.stripe_subscription_id)
        .catch((cause: unknown) => {
          // Already gone on Stripe's side is fine; anything else is not.
          if ((cause as { code?: string }).code !== 'resource_missing') throw cause;
        });
    }

    let customer = tenant.stripe_customer_id ?? null;
    if (!customer) {
      const created = await stripe().customers.create({
        name: tenant.name,
        email: userEmail ?? undefined,
        metadata: { tenant_id: tenant.id, slug: tenant.slug },
      });
      customer = created.id;
      await updateTenantBilling(tenant.id, { stripe_customer_id: customer });
    }

    const trialEnd =
      tenant.plan === 'trial' && tenant.trial_ends_at
        ? Math.floor(new Date(tenant.trial_ends_at).getTime() / 1000)
        : null;
    const twoDaysAhead = Math.floor(Date.now() / 1000) + 2 * 24 * 3600;

    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price, quantity: 1 }],
      subscription_data: {
        metadata: { tenant_id: tenant.id },
        ...(trialEnd && trialEnd > twoDaysAhead ? { trial_end: trialEnd } : {}),
      },
      metadata: { tenant_id: tenant.id },
      ...(automaticTax()
        ? {
            automatic_tax: { enabled: true },
            customer_update: { address: 'auto', name: 'auto' },
            tax_id_collection: { enabled: true },
          }
        : {}),
      success_url: `${baseUrl()}/admin/${encodeURIComponent(slug)}/account?billing=done`,
      cancel_url: `${baseUrl()}/admin/${encodeURIComponent(slug)}/account`,
    });

    return ok({ url: session.url });
  } catch (error) {
    return handleError(error);
  }
}
