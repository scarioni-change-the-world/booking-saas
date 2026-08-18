import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The service-role client.
 *
 * Deliberately NOT exported from the package barrel. service_role bypasses RLS,
 * so an unscoped handle to it is the one object in this codebase that can read
 * across tenants. Everything outside src/lib/db goes through tenantScope().
 *
 * The two legitimate exceptions — resolving a tenant by slug, and resolving a
 * booking by its manage token — are the functions in this module, because both
 * are lookups that establish which tenant we are in and so cannot themselves be
 * tenant-scoped.
 */

let cached: SupabaseClient | null = null;

function serviceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. See .env.example.',
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Internal: only src/lib/db may reach the unscoped client. */
export function __unsafeServiceClient(): SupabaseClient {
  return serviceClient();
}

/** Reset the memoised client. Tests only. */
export function __resetClient(): void {
  cached = null;
}
