import { fail, handleError, ok, readJson, requireString, requireTimezone } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { listTenantMembers, updateTenant } from '@/lib/db/console';
import { DEFAULT_CURRENCY } from '@/lib/money';
import type { TenantSettingsRow } from '@/lib/db/types';

/**
 * What is left of Settings once everything else moved to where it takes
 * effect: the business's name and time zone, what it charges in, who is
 * signed in, who else is on the team, and where the account stands.
 *
 * The team is this business's own members, read with the same function the
 * Console uses, scoped to this tenant's id — an admin sees their own
 * colleagues and nobody else's.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope, userId, role } = await requireTenantAdmin(request, slug);

    const [settings, team] = await Promise.all([scope.select('tenant_settings').maybeSingle(), listTenantMembers(tenant.id)]);
    if (settings.error) throw settings.error;

    return ok({
      business: {
        name: tenant.name,
        slug: tenant.slug,
        timezone: tenant.timezone,
        createdAt: tenant.created_at,
      },
      currency: (settings.data as unknown as TenantSettingsRow | null)?.currency ?? DEFAULT_CURRENCY,
      plan: { plan: tenant.plan, trialEndsAt: tenant.trial_ends_at, freeAccess: tenant.free_access },
      me: { email: team.find((m) => m.userId === userId)?.email ?? null, role },
      team: team.map((m) => ({ email: m.email, role: m.role, you: m.userId === userId })),
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Rename the business, or move it to another time zone.
 *
 * A time zone change keeps every opening hour as the same clock time, now
 * read in the new zone — which is what somebody who moved wants — and every
 * booking already made at the same moment, now shown in the new zone. The
 * screen says both before it is saved.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const patch: { name?: string; timezone?: string } = {};
    if ('name' in body) {
      const name = requireString(body, 'name', { maxLength: 200 }).trim();
      if (!name) return fail('A business needs a name', 400);
      patch.name = name;
    }
    if ('timezone' in body) patch.timezone = requireTimezone(body, 'timezone');
    if (Object.keys(patch).length === 0) return fail('Nothing to change', 400);

    const updated = await updateTenant(tenant.id, patch);
    return ok({ business: { name: updated.name, slug: updated.slug, timezone: updated.timezone, createdAt: updated.created_at } });
  } catch (error) {
    return handleError(error);
  }
}
