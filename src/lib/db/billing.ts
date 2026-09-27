import { __unsafeServiceClient } from './client';
import type { PaymentRow, TenantRow } from './types';

/**
 * The database side of Stripe: finding the business an event is about,
 * writing what Stripe said, and remembering which events were handled.
 *
 * Service-role, as every write to tenants is (see console.ts). A webhook has
 * no signed-in user; what proves it is Stripe is its signature, checked in
 * the route before anything here runs.
 */

type BillingPatch = Partial<
  Pick<
    TenantRow,
    | 'plan'
    | 'stripe_customer_id'
    | 'stripe_subscription_id'
    | 'subscription_status'
    | 'subscription_current_period_end'
    | 'stripe_account_id'
    | 'stripe_charges_enabled'
  >
>;

export async function updateTenantBilling(tenantId: string, patch: BillingPatch): Promise<void> {
  const { error } = await __unsafeServiceClient().from('tenants').update(patch).eq('id', tenantId);
  if (error) throw error;
}

async function tenantWhere(column: string, value: string): Promise<TenantRow | null> {
  const { data, error } = await __unsafeServiceClient()
    .from('tenants')
    .select('*')
    .eq(column, value)
    .maybeSingle();
  if (error) throw error;
  return (data as TenantRow | null) ?? null;
}

export const tenantById = (id: string) => tenantWhere('id', id);
export const tenantByStripeCustomer = (id: string) => tenantWhere('stripe_customer_id', id);
export const tenantByStripeAccount = (id: string) => tenantWhere('stripe_account_id', id);

/** Whether this Stripe event was handled already. */
export async function stripeEventSeen(id: string): Promise<boolean> {
  const { data, error } = await __unsafeServiceClient()
    .from('stripe_events')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function recordStripeEvent(id: string, type: string): Promise<void> {
  const { error } = await __unsafeServiceClient().from('stripe_events').insert({ id, type });
  // 23505: a duplicate delivery recorded it first. Nothing lost.
  if (error && error.code !== '23505') throw error;
}

/** A client's payment found by its Checkout Session — from a webhook, which has no tenant yet. */
export async function paymentByCheckoutSession(sessionId: string): Promise<PaymentRow | null> {
  const { data, error } = await __unsafeServiceClient()
    .from('payments')
    .select('*')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return (data as PaymentRow | null) ?? null;
}

export async function paymentByIntent(intentId: string): Promise<PaymentRow | null> {
  const { data, error } = await __unsafeServiceClient()
    .from('payments')
    .select('*')
    .eq('stripe_payment_intent_id', intentId)
    .maybeSingle();
  if (error) throw error;
  return (data as PaymentRow | null) ?? null;
}
