import { handleError, isResponse, ok, requireTenant } from '@/lib/api';
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
    const { data, error } = await scope.select('outcome_paths');
    if (error) throw error;

    const paths = (data ?? []) as unknown as OutcomePathRow[];
    const otherPath = paths.find((p) => p.type === 'other');

    return ok({
      name: tenant.name,
      timezone: tenant.timezone,
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
