import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeOutcomePath } from '@/lib/admin-serializers';
import type { OutcomePathRow } from '@/lib/db/types';

/**
 * The tenant's outcome paths — 'meeting' and 'other' in v1 (migration 0011).
 * Always exactly two rows; there is no POST here because nothing creates or
 * deletes a path yet, only the auto-seeding trigger.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { data, error } = await scope.select('outcome_paths').order('type', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as unknown as OutcomePathRow[];
    return ok({ paths: rows.map(serializeOutcomePath) });
  } catch (error) {
    return handleError(error);
  }
}
