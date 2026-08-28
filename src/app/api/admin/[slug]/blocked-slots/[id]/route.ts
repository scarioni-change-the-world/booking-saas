import { fail, handleError, ok, optionalNullableString, readJson } from '@/lib/api';
import { requireTenantMember } from '@/lib/auth';
import { updateBlockReason } from '@/lib/blocked-slot-service';

/**
 * Add or change a block's reason after the fact.
 *
 * Blocking happens instantly now, with no "what's this for?" gate — see
 * BlockTimeGrid's history for why that used to be a native window.prompt()
 * and why it isn't any more. This is the affordance that replaced it: the
 * day list's "+ reason" / "edit" action, a small optional annotation rather
 * than a precondition for the block itself.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantMember(request, slug);
    const body = await readJson(request);

    if (!('reason' in body)) return fail('Nothing to update', 400);
    const reason = optionalNullableString(body, 'reason', { maxLength: 500 });

    const found = await updateBlockReason(scope, id, reason ?? null);
    if (!found) return fail('Not found', 404);
    return ok({ updated: true });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Unblock. requireTenantMember, not requireTenantAdmin — same reasoning as
 * the POST above: any team member can undo a block they or a colleague set.
 */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantMember(request, slug);

    const { error } = await scope.delete('blocked_slots').eq('id', id);
    if (error) throw error;

    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
