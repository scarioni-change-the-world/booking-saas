import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeEmailTemplate } from '@/lib/admin-serializers';
import type { EmailTemplateRow } from '@/lib/db/types';

/**
 * The tenant's four transactional email templates (migration 0017). Always
 * exactly four rows; there is no POST here for the same reason
 * outcome-paths has none — nothing creates or deletes one, only the
 * auto-seeding trigger.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { data, error } = await scope.select('email_templates').order('kind', { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as unknown as EmailTemplateRow[];
    return ok({ templates: rows.map(serializeEmailTemplate) });
  } catch (error) {
    return handleError(error);
  }
}
