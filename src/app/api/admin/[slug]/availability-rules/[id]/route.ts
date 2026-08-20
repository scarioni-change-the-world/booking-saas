import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';

/**
 * Remove one window of hours. No PATCH here — changing a rule's time in the
 * dashboard is remove-and-re-add, which is simpler than a second endpoint
 * for something this small.
 */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { error } = await scope.delete('availability_rules').eq('id', id);
    if (error) throw error;

    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
