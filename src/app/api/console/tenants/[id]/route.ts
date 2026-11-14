import {
  fail,
  handleError,
  ok,
  optionalBoolean,
  optionalNullableString,
  optionalString,
  readJson,
  requireTimezone,
} from '@/lib/api';
import { BookingError } from '@/lib/booking-service';
import { requirePlatformStaff } from '@/lib/auth';
import { getTenantById, updateTenant, type UpdateTenantInput } from '@/lib/db/console';
import { serializeTenant } from '@/lib/console-serializers';
import type { TenantPlan, TenantStatus } from '@/lib/db/types';
import { businessDeletionBlockers, slugConfirmed } from '@/lib/business-deletion';
import { BusinessDeletionError, deleteBusiness, loadBusinessDeletionFacts } from '@/lib/business-deletion-server';

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

    // The comped-access override (customer-service compensation) — always
    // wins over plan/trial state, see billing-gate.ts.
    const freeAccess = optionalBoolean(body, 'freeAccess');
    if (freeAccess !== undefined) patch.free_access = freeAccess;

    // The founding price (plans.ts): given by hand to someone who should have
    // it, or taken back from an account made by mistake.
    const founding = optionalBoolean(body, 'founding');
    if (founding !== undefined) patch.founding = founding;

    // The trial-extension lever — a full ISO timestamp so support can push
    // it out by however long is fair, not just whole days. null clears it.
    const trialEndsAt = optionalNullableString(body, 'trialEndsAt', { maxLength: 40 });
    if (trialEndsAt !== undefined) {
      if (trialEndsAt !== null && Number.isNaN(new Date(trialEndsAt).getTime())) {
        throw new BookingError('"trialEndsAt" must be a valid date/time', 400);
      }
      patch.trial_ends_at = trialEndsAt;
    }

    const tenant = await updateTenant(id, patch);
    return ok({ tenant: serializeTenant(tenant) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Delete a business for good (business-deletion.ts). Console owners only;
 * the business must be suspended, owe no paid sessions, and its web
 * address must be typed back as `confirmSlug`. Every one of those is
 * checked here again, whatever the panel showed.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const staff = await requirePlatformStaff(request, 'owner');
    const body = await readJson(request);

    const tenant = await getTenantById(id);
    if (!tenant) return fail('Not found', 404);

    const typed = typeof body.confirmSlug === 'string' ? body.confirmSlug : '';
    if (!slugConfirmed(typed, tenant.slug)) {
      return fail(`Type the business’s web address, ${tenant.slug}, to delete it.`, 400);
    }

    const facts = await loadBusinessDeletionFacts(tenant);
    const blockers = businessDeletionBlockers(facts, staff.role);
    if (blockers.length > 0) return fail(blockers.join(' '), 409);

    const result = await deleteBusiness(tenant);
    return ok({ deleted: true, ...result });
  } catch (error) {
    if (error instanceof BusinessDeletionError) return fail(error.message, 500);
    return handleError(error);
  }
}
