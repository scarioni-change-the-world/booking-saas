import { describe, expect, it } from 'vitest';
import {
  billingState,
  canStartSubscription,
  planForSubscription,
  subscriptionToReplace,
} from '../src/lib/subscription';

describe('planForSubscription', () => {
  it('keeps a business working while it pays, trials or Stripe retries a card', () => {
    expect(planForSubscription('trialing')).toBe('starter');
    expect(planForSubscription('active')).toBe('starter');
    expect(planForSubscription('past_due')).toBe('starter');
  });

  it('closes the account only when Stripe gives up or it is cancelled', () => {
    for (const status of ['unpaid', 'canceled', 'incomplete_expired', 'paused']) {
      expect(planForSubscription(status)).toBe('cancelled');
    }
  });

  it('leaves the plan alone while a first payment is still being attempted', () => {
    expect(planForSubscription('incomplete')).toBeNull();
    expect(planForSubscription('something-new')).toBeNull();
  });
});

describe('billingState', () => {
  it('free access beats everything', () => {
    expect(
      billingState({
        plan: 'cancelled',
        free_access: true,
        subscription_status: 'past_due',
      }),
    ).toBe('free');
  });

  it('a failing card is shown as such, even though the plan is still open', () => {
    expect(
      billingState({
        plan: 'starter',
        free_access: false,
        subscription_status: 'past_due',
      }),
    ).toBe('past_due');
  });

  it('reads trial, active and cancelled from the plan', () => {
    expect(billingState({ plan: 'trial', free_access: false })).toBe('trial');
    expect(
      billingState({
        plan: 'starter',
        free_access: false,
        subscription_status: 'active',
      }),
    ).toBe('active');
    expect(
      billingState({
        plan: 'cancelled',
        free_access: false,
        subscription_status: 'canceled',
      }),
    ).toBe('cancelled');
  });
});

describe('starting a subscription', () => {
  it('is allowed with none, or with one that is over', () => {
    expect(canStartSubscription(null)).toBe(true);
    expect(canStartSubscription(undefined)).toBe(true);
    for (const status of ['canceled', 'incomplete_expired', 'unpaid', 'paused', 'incomplete']) {
      expect(canStartSubscription(status)).toBe(true);
    }
  });

  it('is refused while one is live — that is managed, not bought twice', () => {
    for (const status of ['active', 'trialing', 'past_due']) {
      expect(canStartSubscription(status)).toBe(false);
    }
  });

  it('cancels only what Stripe still holds open', () => {
    expect(subscriptionToReplace('unpaid')).toBe(true);
    expect(subscriptionToReplace('paused')).toBe(true);
    expect(subscriptionToReplace('incomplete')).toBe(true);
    expect(subscriptionToReplace('canceled')).toBe(false);
    expect(subscriptionToReplace(null)).toBe(false);
  });
});
