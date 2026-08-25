import { fail, handleError, ok, optionalString, readJson, requireTimezone } from '@/lib/api';
import { BookingError } from '@/lib/booking-service';
import { requirePlatformStaff } from '@/lib/auth';
import { getTenantById, updateTenant, type UpdateTenantInput } from '@/lib/db/console';
import { serializeTenant } from '@/lib/console-serializers';
import type { TenantPlan, TenantStatus } from '@/lib/db/types';

const STATUSES: TenantStatus[] = ['active', 'suspended', 'deleted'];
const PLANS: TenantPlan[] = ['trial', 'starter', 'pro', 'cancelled'];

/** One business's own record — for loading the detail page directly. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await requirePlatformStaff(request);

    const tenant = await getTenantById(id);
    if (!tenant) return fail('Not found', 404);

    return ok({ tenant: serializeTenant(tenant) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * The on/off switch, and the rest of a business's own record — everything a
 * business's own admins cannot touch about themselves, because none of it is
 * theirs to change: their name and time zone are also editable here for the
 * rare correction (a typo at signup), even though day-to-day that is a
 * business's own business.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await requirePlatformStaff(request, 'admin');
    const body = await readJson(request);

    const patch: UpdateTenantInput = {};

    const name = optionalString(body, 'name', { maxLength: 200 });
    if (name !== undefined) patch.name = name;

    if ('timezone' in body) patch.timezone = requireTimezone(body, 'timezone');

    if ('status' in body) {
      const status = body.status;
      if (typeof status !== 'string' || !STATUSES.includes(status as TenantStatus)) {
        throw new BookingError(`"status" must be one of ${STATUSES.join(', ')}`, 400);
      }
      patch.status = status as TenantStatus;
    }

    if ('plan' in body) {
      const plan = body.plan;
      if (typeof plan !== 'string' || !PLANS.includes(plan as TenantPlan)) {
        throw new BookingError(`"plan" must be one of ${PLANS.join(', ')}`, 400);
      }
      patch.plan = plan as TenantPlan;
    }

    const tenant = await updateTenant(id, patch);
    return ok({ tenant: serializeTenant(tenant) });
  } catch (error) {
    return handleError(error);
  }
}
