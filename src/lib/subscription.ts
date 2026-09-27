import type { TenantPlan } from './db/types';

/**
 * A business paying intro: Stripe's subscription states, read as intro's own
 * plan. Pure, so the webhook and the Account page agree.
 *
 * One plan exists (€7 a month); in the tenants table it is `starter`.
 * Stripe keeps retrying a failed card for a while (past_due), and the
 * business keeps working while it does — cutting somebody's booking page
 * off over a card that expired yesterday would punish their clients for it.
 * Only when Stripe gives up (unpaid, canceled) does the account close.
 */

export type StripeSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/** The plan a subscription in this state means, or null to leave the plan as it is. */
export function planForSubscription(status: string): TenantPlan | null {
  switch (status) {
    case 'trialing':
    case 'active':
    case 'past_due':
      return 'starter';
    case 'unpaid':
    case 'canceled':
    case 'incomplete_expired':
    case 'paused':
      return 'cancelled';
    default:
      // 'incomplete': the first payment is still being attempted. Nothing
      // has been bought yet, and nothing has been lost either.
      return null;
  }
}

export type BillingState = 'free' | 'trial' | 'active' | 'past_due' | 'cancelled';

export interface BillingSubject {
  plan: TenantPlan;
  free_access: boolean;
  subscription_status?: string | null;
}

/** What the Account page says about paying intro. */
export function billingState(tenant: BillingSubject): BillingState {
  if (tenant.free_access) return 'free';
  if (tenant.subscription_status === 'past_due') return 'past_due';
  if (tenant.plan === 'cancelled') return 'cancelled';
  if (tenant.plan === 'trial') return 'trial';
  return 'active';
}

/**
 * Whether a business may start a new subscription: it has none, or the one
 * it had is over. A subscription Stripe gave up on (unpaid), one paused at
 * the end of a trial without a card, or one that never got its first payment
 * is replaced — the checkout route cancels it first, so nobody ends up with
 * two. One that is live, trialling or retrying a card is managed instead.
 */
export function canStartSubscription(status: string | null | undefined): boolean {
  return !status || ['canceled', 'incomplete_expired', 'unpaid', 'paused', 'incomplete'].includes(status);
}

/** Of those, the ones Stripe still holds open and must be cancelled first. */
export function subscriptionToReplace(status: string | null | undefined): boolean {
  return status === 'unpaid' || status === 'paused' || status === 'incomplete';
}
