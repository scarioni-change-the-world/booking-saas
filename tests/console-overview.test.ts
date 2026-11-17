import { describe, expect, it } from 'vitest';
import { consoleOverview, overviewPeriod, type OverviewInput, type OverviewTenant } from '../src/lib/console-overview';
import type { BillingEventRow } from '../src/lib/db/billing-events';

const NOW = new Date('2026-11-17T12:00:00Z');

const tenant = (over: Partial<OverviewTenant> & { id: string }): OverviewTenant => ({
  name: over.id,
  createdAt: '2026-08-01T10:00:00Z',
  plan: 'starter',
  status: 'active',
  freeAccess: false,
  founding: false,
  subscriptionStatus: 'active',
  trialEndsAt: null,
  ...over,
});

const event = (tenant_id: string, state: BillingEventRow['state'], occurred_at: string, over: Partial<BillingEventRow> = {}): BillingEventRow => ({
  tenant_id,
  state,
  founding: false,
  tenant_created_at: '2026-08-01T10:00:00Z',
  occurred_at,
  backfilled: false,
  ...over,
});

const base = (over: Partial<OverviewInput> = {}): OverviewInput => ({
  now: NOW,
  unit: 'month',
  offset: 0,
  tenants: [],
  events: null,
  activity: { bookings: 12, prevBookings: 9, businessesBooked: 3, prevBusinessesBooked: 2 },
  ai: [{ kind: 'assistant', used: 40, businessesAtLimit: 0 }],
  failures: { emails: 0, calendar: 1 },
  foundingSeats: 100,
  ...over,
});

describe('overviewPeriod', () => {
  it('names and bounds a month, a week back and a quarter', () => {
    const m = overviewPeriod('month', 0, NOW);
    expect(m.label).toBe('November 2026');
    expect(m.from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(m.previous.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(overviewPeriod('month', 2, NOW).label).toBe('September 2026');
    expect(overviewPeriod('quarter', 0, NOW).label).toBe('Q4 2026');
    expect(overviewPeriod('week', 0, NOW).label).toBe('Week of 16 Nov 2026');
  });
});

describe('consoleOverview', () => {
  it('counts paying businesses and revenue at both prices, VAT included', () => {
    const o = consoleOverview(
      base({
        tenants: [
          tenant({ id: 'a' }),
          tenant({ id: 'b', founding: true }),
          tenant({ id: 'c', subscriptionStatus: 'past_due' }),
          tenant({ id: 'd', plan: 'trial', subscriptionStatus: null }),
          tenant({ id: 'e', freeAccess: true }),
          tenant({ id: 'f', plan: 'cancelled', subscriptionStatus: 'canceled' }),
        ],
      }),
    );
    expect(o.lines.paying.now).toBe(3);
    expect(o.lines.revenue.now).toBe(1500 + 900 + 1500);
    expect(o.lines.revenue.founding).toBe(1);
    // Without history there is no "before", and nothing lost can be counted.
    expect(o.lines.paying.before).toBeNull();
    expect(o.lines.lost).toBeNull();
    expect(o.needs.paymentFailed.map((t) => t.id)).toEqual(['c']);
  });

  it('reads the period before, and losses, from the billing history', () => {
    const events = [
      event('a', 'active', '2026-09-20T00:00:00Z', { backfilled: true }),
      event('b', 'active', '2026-09-20T00:00:00Z', { backfilled: true, founding: true }),
      event('b', 'cancelled', '2026-11-05T00:00:00Z', { founding: true }),
      event('z', 'active', '2026-09-20T00:00:00Z', { backfilled: true, tenant_created_at: '2026-11-02T00:00:00Z' }),
      event('z', 'deleted', '2026-11-10T00:00:00Z', { tenant_created_at: '2026-11-02T00:00:00Z' }),
    ];
    const o = consoleOverview(
      base({
        tenants: [tenant({ id: 'a' }), tenant({ id: 'b', founding: true, plan: 'cancelled', subscriptionStatus: 'canceled' })],
        events,
      }),
    );
    expect(o.lines.paying.before).toBe(3);
    expect(o.lines.revenue.before).toBe(1500 + 900 + 1500);
    expect(o.lines.lost).toEqual({ cancelled: 1, deleted: 1, complete: true });
    // A deleted business still counts as a sign-up in its month.
    expect(o.lines.signups.now).toBe(1);
  });

  it('says how many ended trials pay, and which trials end within a week', () => {
    const o = consoleOverview(
      base({
        tenants: [
          tenant({ id: 'paid', trialEndsAt: '2026-11-03T00:00:00Z' }),
          tenant({ id: 'lapsed', plan: 'trial', subscriptionStatus: null, trialEndsAt: '2026-11-09T00:00:00Z' }),
          tenant({ id: 'soon', plan: 'trial', subscriptionStatus: null, trialEndsAt: '2026-11-20T00:00:00Z' }),
          tenant({ id: 'later', plan: 'trial', subscriptionStatus: null, trialEndsAt: '2026-12-10T00:00:00Z' }),
        ],
      }),
    );
    expect(o.lines.trials).toEqual({ ended: 2, converted: 1 });
    expect(o.needs.trialsEnding.map((t) => t.id)).toEqual(['soon']);
  });

  it('builds the revenue trend and sign-up months only where history exists', () => {
    const events = [
      event('a', 'active', '2026-09-02T00:00:00Z', { backfilled: true, tenant_created_at: '2026-07-10T00:00:00Z' }),
      event('b', 'active', '2026-10-15T00:00:00Z', { tenant_created_at: '2026-10-01T00:00:00Z' }),
    ];
    const o = consoleOverview(
      base({
        tenants: [
          tenant({ id: 'a', createdAt: '2026-07-10T00:00:00Z' }),
          tenant({ id: 'b', createdAt: '2026-10-01T00:00:00Z' }),
        ],
        events,
      }),
    );
    expect(o.history.revenue.map((r) => r.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(o.history.revenue.at(-1)).toMatchObject({ minor: 3000, paying: 2 });
    const july = o.history.cohorts.find((c) => c.month === '2026-07')!;
    // July + 1 month (10 Aug) is before history began (2 Sep); + 2 and + 3 are after.
    expect(july.paying).toEqual(['unknown', 1, 1]);
    const october = o.history.cohorts.find((c) => c.month === '2026-10')!;
    expect(october.paying).toEqual([1, null, null]);
  });

  it('carries nothing from inside a business: only totals for activity and use', () => {
    const o = consoleOverview(base({ tenants: [tenant({ id: 'a' })] }));
    expect(o.activity).toEqual({ bookings: 12, prevBookings: 9, businessesBooked: 3, prevBusinessesBooked: 2, activeBusinesses: 1 });
    expect(JSON.stringify(o.costs)).not.toContain('"a"');
    // Per business, only its name and billing facts, and only in "Needs you".
    expect(Object.keys(o.needs)).toEqual(['trialsEnding', 'paymentFailed']);
  });
});
