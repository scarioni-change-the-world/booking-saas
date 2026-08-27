import { fail, handleError, ok, optionalNullableString, optionalString, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeClient } from '@/lib/admin-serializers';
import type { ClientRow } from '@/lib/db/types';

/** Correct a client's name or notes. Their email and access link don't move. */
export async function PATCH(request: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);

    const patch: Partial<Pick<ClientRow, 'name' | 'notes'>> = {};

    const name = optionalString(body, 'name', { maxLength: 200 });
    if (name !== undefined) patch.name = name;

    const notes = optionalNullableString(body, 'notes', { maxLength: 2000 });
    if (notes !== undefined) patch.notes = notes;

    const { data, error } = await scope.update('clients', patch).eq('id', id).select();
    if (error) throw error;

    const row = (data as unknown as ClientRow[])[0];
    if (!row) return fail('Not found', 404);

    return ok({ client: serializeClient(row) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Remove a client record. Their past bookings aren't touched — client_id
 * just goes back to null on them (migration 0010) — this only removes the
 * client record and their private link itself.
 */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { error } = await scope.delete('clients').eq('id', id);
    if (error) throw error;

    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
