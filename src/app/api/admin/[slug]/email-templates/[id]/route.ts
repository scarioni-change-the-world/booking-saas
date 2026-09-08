import { fail, handleError, ok, optionalString, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeEmailTemplate } from '@/lib/admin-serializers';
import type { EmailTemplateRow } from '@/lib/db/types';

/**
 * Update a template's wording. `kind` never changes — it is the row's
 * identity (migration 0017's unique(tenant_id, kind)), same as
 * outcome_paths.type, so it is not accepted here. No token validation
 * against the allowed set (src/lib/email/templates.ts's TEMPLATE_TOKENS):
 * an unrecognised {{token}} renders literally rather than blocking the
 * save, which is friendlier than rejecting a typo for a reason the tenant
 * has to guess at.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const patch: Partial<EmailTemplateRow> = {};

    const subject = optionalString(body, 'subject', { maxLength: 300 });
    if (subject !== undefined) patch.subject = subject;

    const templateBody = optionalString(body, 'body', { maxLength: 5000 });
    if (templateBody !== undefined) patch.body = templateBody;

    if (Object.keys(patch).length === 0) {
      return fail('Nothing to update', 400);
    }

    patch.updated_at = new Date().toISOString();

    const { data, error } = await scope.update('email_templates', patch).eq('id', id).select();
    if (error) throw error;

    const row = (data as unknown as EmailTemplateRow[])[0];
    if (!row) return fail('Not found', 404);

    return ok({ template: serializeEmailTemplate(row) });
  } catch (error) {
    return handleError(error);
  }
}
