import type { TenantRow } from './db/types';
import { accountState } from './subscription';

/** camelCase, matching the same convention the tenant-admin API already uses. */
export function serializeTenant(row: TenantRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    plan: row.plan,
    status: row.status,
    createdAt: row.created_at,
    trialEndsAt: row.trial_ends_at,
    freeAccess: row.free_access,
    founding: !!row.founding,
    /** Account facts only: how the business stands with khloe's own billing. */
    billing: accountState(row),
    renewsAt: row.subscription_current_period_end ?? null,
  };
}

export type SerializedTenant = ReturnType<typeof serializeTenant>;
