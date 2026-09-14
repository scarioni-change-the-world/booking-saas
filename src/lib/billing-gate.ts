import type { TenantPlan } from './db/types';

/**
 * Whether a tenant has lost access — the qualification gate's own product
 * philosophy, pointed at the business itself instead of its prospects: no
 * silent degradation, a clear reason, and — same as everywhere else in this
 * codebase — a small pure function directly testable without a database.
 *
 * Nothing here schedules anything. This is a plain computed check, run at
 * request time in the two places every request already funnels through
 * (requireTenantMembership for the dashboard, requireTenant for the public
 * booking surface — see auth.ts and api.ts) — not a cron job flipping a
 * status field on a schedule, which would need its own infrastructure and
 * could simply fail to run. "Gated" is just "true right now," recomputed
 * on every call.
 */
export interface GateSubject {
  plan: TenantPlan;
  free_access: boolean;
  trial_ends_at: string | null;
}

export function tenantIsGated(tenant: GateSubject): boolean {
  // The one override that beats everything else — a comped account never
  // gates, no matter what its plan or trial state says underneath.
  if (tenant.free_access) return false;

  if (tenant.plan === 'cancelled') return true;

  if (tenant.plan === 'trial') {
    // No trial_ends_at set is a defensive default, not an expiry — every
    // tenant created through the real signup flow gets one immediately, but
    // one created by hand (or predating this gate) may not, and "we don't
    // know when this ends" should never be read as "this already ended."
    if (!tenant.trial_ends_at) return false;
    return new Date(tenant.trial_ends_at).getTime() < Date.now();
  }

  // starter, pro: a paid plan always passes. Keeping this accurate once a
  // subscription actually lapses is a billing-webhook concern, not this
  // function's — it only ever answers "given what's on the tenant row right
  // now, should this be gated."
  return false;
}

/** The message shown wherever the gate actually blocks something — see
 * requireTenantMembership (the dashboard) and requireTenant (the public
 * booking surface) for the two places this is used. */
export const TRIAL_ENDED_MESSAGE = 'Your trial has ended.';
