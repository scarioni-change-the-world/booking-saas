import { handleError, ok } from '@/lib/api';
import { requirePlatformStaff } from '@/lib/auth';
import { listAllTenants, loadPlatformHealth } from '@/lib/db/console';
import { byUrgency, diagnose, miniFlow } from '@/lib/tenant-health';

const WINDOW_DAYS = 14;

/**
 * What needs looking at, across every business on the platform.
 *
 * Any staff member may read this, deliberately — it is the least
 * privileged view of somebody else's account this product has. What comes
 * back is counts, timestamps and fixed words: no client, no email address,
 * no question, no answer. The point of that is not only privacy but
 * usefulness, since every support case worth chasing is a shape and none
 * of them need a name.
 *
 * `slug` and `name` are the business's own, which are on their public
 * booking page already — they are here so a finding can be acted on
 * rather than admired.
 */
export async function GET(request: Request) {
  try {
    await requirePlatformStaff(request);

    const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const [tenants, health] = await Promise.all([listAllTenants(), loadPlatformHealth(sinceIso)]);

    const rows = tenants.map((tenant) => {
      const facts = health.get(tenant.id);
      return {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        findings: facts ? diagnose(facts) : [],
        /* The same facts drawn as the business's flow, five parts long —
           still nothing but counts and fixed words. */
        flow: facts ? miniFlow(facts) : null,
        activity: facts
          ? {
              lastBookingAt: facts.lastBookingAt,
              lastEnquiryAt: facts.lastEnquiryAt,
              activeServices: facts.activeServices,
            }
          : null,
      };
    });

    return ok({ windowDays: WINDOW_DAYS, tenants: byUrgency(rows) });
  } catch (error) {
    return handleError(error);
  }
}
