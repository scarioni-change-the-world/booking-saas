import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { tenantIsGated } from '@/lib/billing-gate';
import { stripeConfigured, subscriptionPriceId } from '@/lib/stripe';
import { billingState, canStartSubscription } from '@/lib/subscription';

/**
 * Confirms the signed-in person may administer this specific tenant, and
 * hands back enough to render the dashboard shell without a second call.
 *
 * The dashboard layout calls this once on load. A 401/403/404 here is what
 * sends the browser back to the login page rather than rendering a shell for
 * a business the caller cannot actually touch.
 *
 * A business locked out after its trial, or whose subscription ended, is
 * still answered (allowGated) — with `gated` set and where its plan stands,
 * so the lock screen can offer the way back in: subscribing.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, role } = await requireTenantAdmin(request, slug, {
      allowGated: true,
    });
    const gated = tenantIsGated(tenant);
    return ok({
      name: tenant.name,
      slug: tenant.slug,
      role,
      gated,
      ...(gated
        ? {
            plan: {
              plan: tenant.plan,
              trialEndsAt: tenant.trial_ends_at,
              freeAccess: tenant.free_access,
              state: billingState(tenant),
              renewsAt: tenant.subscription_current_period_end ?? null,
              hasCustomer: !!tenant.stripe_customer_id,
              canSubscribe:
                stripeConfigured() &&
                !!subscriptionPriceId() &&
                canStartSubscription(tenant.subscription_status),
            },
          }
        : {}),
    });
  } catch (error) {
    return handleError(error);
  }
}
