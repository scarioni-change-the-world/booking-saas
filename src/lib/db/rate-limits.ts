import { __unsafeServiceClient } from './client';

/**
 * The counter behind src/lib/rate-limit.ts, kept here for the same reason
 * every other query lives in this directory: this module is the only place
 * allowed to hold the unscoped client.
 *
 * Unscoped is correct here rather than a TenantScope: the tenant is already
 * baked into the key the caller builds, and these rows are throwaway
 * counters rather than tenant data — see migration 0019 for why they have
 * no tenant_id column to scope by in the first place.
 *
 * Counting and deciding happen in one statement inside Postgres (the
 * consume_rate_limit function), not here — a read followed by a write from
 * this side could interleave with another instance doing the same.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await __unsafeServiceClient().rpc('consume_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) throw error;
  return data === true;
}
