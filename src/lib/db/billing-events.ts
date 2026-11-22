import { __unsafeServiceClient } from './client';
import { accountState, type BillingSubject } from '../subscription';
import type { TenantRow } from './types';

/**
 * Billing history for the owner console (migration 0040): a row each time a
 * business's billing state changes. Account facts only.
 *
 * Recording never stops the thing it records: a sign-up, a Stripe event or
 * a deletion goes ahead even if the history could not be written (before
 * the migration runs, say). The miss is logged.
 */

export type BillingEventState = 'trial' | 'free' | 'active' | 'past_due' | 'cancelled' | 'deleted';

export interface BillingEventRow {
  tenant_id: string;
  state: BillingEventState;
  founding: boolean;
  tenant_created_at: string;
  occurred_at: string;
  backfilled: boolean;
}

type Subject = BillingSubject & Pick<TenantRow, 'id' | 'created_at'> & { founding?: boolean };

/** The state a business is in now, as the history records it. */
export function eventStateOf(tenant: BillingSubject): BillingEventState {
  return accountState(tenant);
}

/**
 * Write the business's state if it differs from the last one recorded.
 * `state` overrides what its row says (for 'deleted').
 */
export async function recordBillingState(tenant: Subject, state: BillingEventState = eventStateOf(tenant)): Promise<void> {
  try {
    const client = __unsafeServiceClient();
    const last = await client
      .from('billing_events')
      .select('state')
      .eq('tenant_id', tenant.id)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last.error) throw last.error;
    if ((last.data as { state?: string } | null)?.state === state) return;
    const { error } = await client.from('billing_events').insert({
      tenant_id: tenant.id,
      state,
      founding: !!tenant.founding,
      tenant_created_at: tenant.created_at,
    });
    if (error) throw error;
  } catch (cause) {
    console.error('[billing-events] not recorded:', (cause as Error).message ?? cause);
  }
}

/** Every recorded change, oldest first, for the console's trends. Null before migration 0040. */
export async function listBillingEvents(): Promise<BillingEventRow[] | null> {
  const { data, error } = await __unsafeServiceClient()
    .from('billing_events')
    .select('tenant_id, state, founding, tenant_created_at, occurred_at, backfilled')
    .order('occurred_at', { ascending: true })
    .limit(50_000);
  if (error) return null;
  return (data ?? []) as BillingEventRow[];
}
