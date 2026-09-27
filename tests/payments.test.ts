import { describe, expect, it } from 'vitest';
import {
  amountDue,
  heldBusy,
  paymentSettingProblem,
  refundDecision,
  type PayableService,
} from '@/lib/payments';
import { billingState, planForSubscription } from '@/lib/subscription';

const single: PayableService = {
  priceMinor: 6500,
  paymentMode: 'full',
  depositMinor: null,
  bookingMode: 'single',
  packSize: null,
};
const pack: PayableService = {
  priceMinor: 7000,
  paymentMode: 'full',
  depositMinor: null,
  bookingMode: 'pack',
  packSize: 10,
};

describe('amountDue', () => {
  it('charges the price of one session, or of the whole programme', () => {
    expect(amountDue(single)).toEqual({
      kind: 'full',
      amountMinor: 6500,
      totalMinor: 6500,
      sessions: 1,
    });
    expect(amountDue(pack)).toEqual({
      kind: 'full',
      amountMinor: 70000,
      totalMinor: 70000,
      sessions: 10,
    });
  });

  it('charges only the deposit when that is the setting', () => {
    expect(amountDue({ ...pack, paymentMode: 'deposit', depositMinor: 15000 })).toEqual({
      kind: 'deposit',
      amountMinor: 15000,
      totalMinor: 70000,
      sessions: 10,
    });
  });

  it('charges nothing with no price, a zero price, or paying online turned off', () => {
    expect(amountDue({ ...single, priceMinor: null })).toBeNull();
    expect(amountDue({ ...single, priceMinor: 0 })).toBeNull();
    expect(amountDue({ ...single, paymentMode: 'none' })).toBeNull();
    expect(amountDue({ ...single, paymentMode: 'deposit', depositMinor: null })).toBeNull();
  });
});

describe('paymentSettingProblem', () => {
  it('lets paying online be turned off at any time', () => {
    expect(
      paymentSettingProblem({
        ...single,
        paymentMode: 'none',
        priceMinor: null,
      }),
    ).toBeNull();
  });
  it('asks for a price before anything can be charged', () => {
    expect(paymentSettingProblem({ ...single, priceMinor: null })).toMatch(/price first/);
  });
  it('refuses a missing deposit, or one as large as the full price', () => {
    expect(paymentSettingProblem({ ...single, paymentMode: 'deposit' })).toMatch(/deposit/);
    expect(
      paymentSettingProblem({
        ...single,
        paymentMode: 'deposit',
        depositMinor: 6500,
      }),
    ).toMatch(/less than/);
    expect(
      paymentSettingProblem({
        ...pack,
        paymentMode: 'deposit',
        depositMinor: 20000,
      }),
    ).toBeNull();
  });
});

describe('refundDecision', () => {
  const base = {
    by: 'client' as const,
    startsAt: '2026-10-10T10:00:00Z',
    now: new Date('2026-10-08T10:00:00Z'),
    noticeHours: 24,
    inProgramme: false,
    paid: true,
  };

  it('refunds a client who cancels at least the notice ahead', () => {
    expect(refundDecision(base)).toEqual({ refund: true, reason: 'in-time' });
  });
  it('keeps the payment when a client cancels later than that', () => {
    expect(refundDecision({ ...base, now: new Date('2026-10-10T00:00:00Z') })).toEqual({
      refund: false,
      reason: 'late',
    });
  });
  it('always refunds when the business cancels', () => {
    expect(
      refundDecision({
        ...base,
        by: 'business',
        now: new Date('2026-10-10T09:00:00Z'),
      }),
    ).toEqual({
      refund: true,
      reason: 'business-cancelled',
    });
  });
  it('never refunds a programme session: it goes back to be rebooked', () => {
    expect(refundDecision({ ...base, inProgramme: true, by: 'business' })).toEqual({
      refund: false,
      reason: 'programme',
    });
  });
  it('has nothing to refund when nothing was paid', () => {
    expect(refundDecision({ ...base, paid: false })).toEqual({
      refund: false,
      reason: 'not-paid',
    });
  });
});

describe('heldBusy', () => {
  const now = new Date('2026-10-01T10:00:00Z');
  const range = { start: '2026-10-02T09:00:00Z', end: '2026-10-02T09:30:00Z' };
  it('counts only open holds that have not run out', () => {
    const holds = [
      {
        status: 'open',
        expires_at: '2026-10-01T10:20:00Z',
        slot_ranges: [range],
      },
      {
        status: 'open',
        expires_at: '2026-10-01T09:59:00Z',
        slot_ranges: [range],
      },
      {
        status: 'paid',
        expires_at: '2026-10-01T10:20:00Z',
        slot_ranges: [range],
      },
    ];
    expect(heldBusy(holds, now)).toEqual([range]);
  });
  it('leaves out the hold being completed, so it does not block itself', () => {
    const holds = [
      {
        status: 'open',
        expires_at: '2026-10-01T10:20:00Z',
        slot_ranges: [range],
      },
    ];
    expect(heldBusy(holds, now, 'p1', ['p1'])).toEqual([]);
  });
});

describe('subscriptions', () => {
  it('keeps a business working while Stripe retries a card', () => {
    expect(planForSubscription('trialing')).toBe('starter');
    expect(planForSubscription('active')).toBe('starter');
    expect(planForSubscription('past_due')).toBe('starter');
  });
  it('closes the account only once Stripe gives up', () => {
    expect(planForSubscription('canceled')).toBe('cancelled');
    expect(planForSubscription('unpaid')).toBe('cancelled');
    expect(planForSubscription('incomplete')).toBeNull();
  });
  it('says where a business stands', () => {
    expect(billingState({ plan: 'trial', free_access: false })).toBe('trial');
    expect(
      billingState({
        plan: 'starter',
        free_access: false,
        subscription_status: 'past_due',
      }),
    ).toBe('past_due');
    expect(
      billingState({
        plan: 'starter',
        free_access: false,
        subscription_status: 'active',
      }),
    ).toBe('active');
    expect(billingState({ plan: 'cancelled', free_access: true })).toBe('free');
  });
});
