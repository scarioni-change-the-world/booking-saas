import { handleError, ok, readJson, requireEmail } from '@/lib/api';
import { BookingError } from '@/lib/booking-service';
import { requirePlatformStaff } from '@/lib/auth';
import { addTenantMember, listTenantMembers } from '@/lib/db/console';
import type { MemberRole } from '@/lib/db/types';

const ROLES: MemberRole[] = ['owner', 'admin', 'member'];

/** Who currently has access to one business's dashboard. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await requirePlatformStaff(request);

    const members = await listTenantMembers(id);
    return ok({ members });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Give someone access — this is the only place that exists to do it today,
 * since a business inviting its own teammates isn't built yet.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await requirePlatformStaff(request, 'admin');
    const body = await readJson(request);

    const email = requireEmail(body, 'email');
    const roleValue = body.role;
    if (typeof roleValue !== 'string' || !ROLES.includes(roleValue as MemberRole)) {
      throw new BookingError(`"role" must be one of ${ROLES.join(', ')}`, 400);
    }

    const member = await addTenantMember(id, email, roleValue as MemberRole);
    return ok({ member }, 201);
  } catch (error) {
    return handleError(error);
  }
}
