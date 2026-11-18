import { handleError, isResponse, ok, requireTenant } from '@/lib/api';
import { DEFAULT_CURRENCY } from '@/lib/money';
import type { OutcomePathRow } from '@/lib/db/types';

/**
 * Public tenant configuration for the widget.
 *
 * Only fields the widget renders. Notably absent: notification_email and
 * anything else the tenant would not expect on a public page.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const resolved = await requireTenant(slug);
    if (isResponse(resolved)) return resolved;

    const { tenant, scope } = resolved;
    const [outcomes, settings] = await Promise.all([
      scope.select('outcome_paths'),
      scope.select('tenant_settings').maybeSingle(),
    ]);
    const { data, error } = outcomes;
    if (error) throw error;
    if (settings.error) throw settings.error;

    const paths = (data ?? []) as unknown as OutcomePathRow[];
    const otherPath = paths.find((p) => p.type === 'other');

    return ok({
      name: tenant.name,
      timezone: tenant.timezone,
      // A tenant always has a settings row (migration 0009's trigger), but
      // the fallback keeps a price renderable rather than crashing the page
      // if one is ever missing.
      currency:
        (settings.data as unknown as { currency?: string } | null)?.currency ?? DEFAULT_CURRENCY,
      branding: tenant.branding,
      otherPath: {
        message: otherPath?.message ?? '',
        redirectUrl: otherPath?.redirect_url ?? null,
        redirectLabel: otherPath?.redirect_label ?? null,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
