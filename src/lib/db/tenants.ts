import { __unsafeServiceClient } from './client';
import { TenantScope, tenantScope } from './scope';
import type { BookingRow, TenantRow } from './types';

/**
 * Tenant resolution.
 *
 * These are the only unscoped reads in the codebase, and both are unscoped for
 * the same reason: they are what establishes which tenant a request belongs to.
 * Each returns a TenantScope alongside the row, so a caller moves from "no
 * tenant" to "exactly one tenant" in a single step and never holds a bare
 * client.
 */

export interface ResolvedTenant {
  tenant: TenantRow;
  scope: TenantScope;
}

/** Resolve the tenant behind a public booking URL, e.g. /t/acme-coaching. */
export async function resolveTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  const { data, error } = await __unsafeServiceClient()
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const tenant = data as TenantRow;
  return { tenant, scope: tenantScope(tenant.id) };
}

/**
 * Resolve a booking from its manage token.
 *
 * The token IS the credential — there is no login (brief 2.4) — so this lookup
 * is by token alone and must stay constant in shape regardless of whether the
 * token exists. Callers return an identical 404 either way, so the endpoint
 * cannot be used to confirm that a token is valid.
 */
export async function resolveBookingByToken(
  token: string,
): Promise<{ booking: BookingRow; tenant: TenantRow; scope: TenantScope } | null> {
  if (!token || token.length < 20) return null;

  const { data, error } = await __unsafeServiceClient()
    .from('bookings')
    .select('*, tenants!inner(*)')
    .eq('manage_token', token)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { tenants, ...booking } = data as BookingRow & { tenants: TenantRow };
  return { booking: booking as BookingRow, tenant: tenants, scope: tenantScope(tenants.id) };
}
