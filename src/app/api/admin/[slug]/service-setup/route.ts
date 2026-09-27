import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { loadSetupFacts } from '@/lib/setup-facts';
import { stripeConfigured } from '@/lib/stripe';

/** Everything the setup model needs, for every service — see loadSetupFacts. */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const facts = await loadSetupFacts(scope);
    return ok({
      services: facts.services,
      globalQuestionCount: facts.globalQuestionCount,
      availabilityRuleCount: facts.availabilityRuleCount,
      hasOtherPathMessage: facts.hasOtherPathMessage,
      hasOtherPathUrl: facts.hasOtherPathUrl,
      // Whether a service can be paid for when booked: the business's own
      // Stripe account is connected and able to take charges.
      takesPayments: !!tenant.stripe_charges_enabled && stripeConfigured(),
    });
  } catch (error) {
    return handleError(error);
  }
}
