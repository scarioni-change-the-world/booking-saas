import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { loadSetupFacts } from '@/lib/setup-facts';

/** Everything the setup model needs, for every service — see loadSetupFacts. */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const facts = await loadSetupFacts(scope);
    return ok({
      services: facts.services,
      globalQuestionCount: facts.globalQuestionCount,
      availabilityRuleCount: facts.availabilityRuleCount,
      hasOtherPathMessage: facts.hasOtherPathMessage,
      hasOtherPathUrl: facts.hasOtherPathUrl,
    });
  } catch (error) {
    return handleError(error);
  }
}
