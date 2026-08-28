import { handleError, ok } from '@/lib/api';
import { requireTenantMember } from '@/lib/auth';

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
