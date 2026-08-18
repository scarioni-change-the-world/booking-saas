import type { SupabaseClient } from '@supabase/supabase-js';
import { __unsafeServiceClient } from './client';
import type { TenantScopedTable, TenantScopedTables } from './types';

/**
 * Structural tenant scoping.
 *
 * Brief 7.1: "RLS is far safer against a missed WHERE clause — a single
 * omission leaks another tenant's client list." The RLS policies in
 * migration 0005 deliver that for the dashboard, where requests arrive as the
 * `authenticated` role.
 *
 * The public booking surface cannot work that way: a prospect is anonymous, and
 * `anon` is denied every table. Those requests run server-side as service_role,
 * which bypasses RLS — so on that path the missed WHERE clause is a live risk
 * again. This class closes it by construction. Every query is built from a
 * tenant id, `tenant_id` is applied by the builder rather than by the caller,
 * and the unscoped client is not exported. Forgetting the filter is not
 * something a caller can do, because a caller never writes it.
 *
 * The invariants, each covered in tests/scope.test.ts:
 *
 *   - every read is filtered to this tenant;
 *   - every insert has this tenant's id stamped on it, overwriting any
 *     tenant_id the request body tried to supply;
 *   - an update can neither escape this tenant nor move a row to another one;
 *   - a delete cannot reach beyond this tenant.
 */
export class TenantScope {
  constructor(
    readonly tenantId: string,
    private readonly db: SupabaseClient,
  ) {}

  /** A read, pre-filtered to this tenant. */
  select<T extends TenantScopedTable>(table: T, columns = '*') {
    return this.db.from(table).select(columns).eq('tenant_id', this.tenantId);
  }

  /**
   * An insert, with this tenant's id stamped on every row.
   *
   * The spread order matters: tenant_id goes last so a caller — or a request
   * body that reached this far — cannot set it to someone else's tenant.
   */
  insert<T extends TenantScopedTable>(
    table: T,
    values: Partial<TenantScopedTables[T]> | Array<Partial<TenantScopedTables[T]>>,
  ) {
    const rows = (Array.isArray(values) ? values : [values]).map((row) => ({
      ...row,
      tenant_id: this.tenantId,
    }));
    return this.db.from(table).insert(rows).select();
  }

  /**
   * An update, confined to this tenant.
   *
   * tenant_id is stripped from the patch rather than overwritten: an update
   * that tried to set it was attempting to move a row across the tenant
   * boundary, and silently rewriting it to the current tenant would hide that.
   */
  update<T extends TenantScopedTable>(table: T, patch: Partial<TenantScopedTables[T]>) {
    const { tenant_id: _discarded, ...safe } = patch as Record<string, unknown>;
    return this.db.from(table).update(safe).eq('tenant_id', this.tenantId);
  }

  /** A delete, confined to this tenant. */
  delete<T extends TenantScopedTable>(table: T) {
    return this.db.from(table).delete().eq('tenant_id', this.tenantId);
  }
}

/**
 * Build a scope for one tenant.
 *
 * @param client injectable for tests; production callers omit it.
 */
export function tenantScope(tenantId: string, client?: SupabaseClient): TenantScope {
  if (!tenantId) throw new Error('tenantScope requires a tenant id');
  return new TenantScope(tenantId, client ?? __unsafeServiceClient());
}
