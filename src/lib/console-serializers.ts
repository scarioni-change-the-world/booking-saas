import type { TenantRow } from './db/types';

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
  };
}

export type SerializedTenant = ReturnType<typeof serializeTenant>;
