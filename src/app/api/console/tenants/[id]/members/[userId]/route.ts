import { handleError, ok } from '@/lib/api';
import { requirePlatformStaff } from '@/lib/auth';
import { removeTenantMember } from '@/lib/db/console';

/** Take someone's access away. Refuses to remove a business's last owner. */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const { id, userId } = await ctx.params;
    await requirePlatformStaff(request, 'admin');

    await removeTenantMember(id, userId);
    return ok({ removed: true });
  } catch (error) {
    return handleError(error);
  }
}
