import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';

/** Remove one exception, returning that date to the normal weekly schedule. */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { error } = await scope.delete('date_overrides').eq('id', id);
    if (error) throw error;

    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
