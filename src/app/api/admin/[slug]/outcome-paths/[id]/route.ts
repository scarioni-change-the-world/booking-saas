import { fail, handleError, ok, optionalNullableString, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeOutcomePath } from '@/lib/admin-serializers';
import type { OutcomePathRow } from '@/lib/db/types';

/**
 * Update one outcome path — its admin-facing name, or what a prospect sees
 * when sent down it. `type` never changes: it is the row's identity (see
 * migration 0011's unique(tenant_id, type)), so it is not accepted here.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const patch: Partial<OutcomePathRow> = {};

    const name = optionalNullableString(body, 'name', { maxLength: 200 });
    if (name !== undefined && name !== null) patch.name = name;

    const message = optionalNullableString(body, 'message', { maxLength: 2000 });
    if (message !== undefined) patch.message = message ?? '';

    const redirectUrl = optionalNullableString(body, 'redirectUrl', { maxLength: 2000 });
    if (redirectUrl !== undefined) patch.redirect_url = redirectUrl;

    const redirectLabel = optionalNullableString(body, 'redirectLabel', { maxLength: 200 });
    if (redirectLabel !== undefined) patch.redirect_label = redirectLabel;

    if (Object.keys(patch).length === 0) {
      return fail('Nothing to update', 400);
    }

    const { data, error } = await scope.update('outcome_paths', patch).eq('id', id).select();
    if (error) throw error;

    const row = (data as unknown as OutcomePathRow[])[0];
    if (!row) return fail('Not found', 404);

    return ok({ path: serializeOutcomePath(row) });
  } catch (error) {
    return handleError(error);
  }
}
