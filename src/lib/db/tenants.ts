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

/**
 * Replace which sites may frame this tenant's booking widget.
 *
 * By tenant id rather than through TenantScope, because the scope filters
 * every query on a `tenant_id` column and `tenants` is keyed by `id` — a
 * scoped update against this table would filter on a column that does not
 * exist. The safety here comes from the caller instead: the only route that
 * reaches this has already passed requireTenantAdmin for this exact slug.
 *
 * The values are validated in src/lib/embed.ts before they arrive. They end
 * up in a CSP header, so that validation is load-bearing rather than
 * cosmetic, and this function deliberately does not re-interpret them.
 */
export async function replaceTenantEmbedDomains(
  tenantId: string,
  domains: readonly string[],
): Promise<string[]> {
  const { data, error } = await __unsafeServiceClient()
    .from('tenants')
    .update({ embed_domains: domains })
    .eq('id', tenantId)
    .select('embed_domains')
    .single();

  if (error) throw error;
  return (data as { embed_domains: string[] }).embed_domains ?? [];
}

/** Which sites may frame this tenant's widget right now. */
export async function tenantEmbedDomains(tenantId: string): Promise<string[]> {
  const { data, error } = await __unsafeServiceClient()
    .from('tenants')
    .select('embed_domains')
    .eq('id', tenantId)
    .single();

  if (error) throw error;
  return (data as { embed_domains: string[] }).embed_domains ?? [];
}
