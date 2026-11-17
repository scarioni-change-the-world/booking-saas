import { DateTime } from 'luxon';
import { FOUNDING_PRICE_MINOR, STANDARD_PRICE_MINOR } from './plans';
import { billingState } from './subscription';
import type { BillingEventRow, BillingEventState } from './db/billing-events';
import type { AiUsageKind, TenantPlan } from './db/types';

/**
 * The owner console's Overview: how the khloe business is doing, from
 * account and billing facts and platform-wide totals only.
 *
 * Privacy rule (the owner's): nothing from inside a business reaches the
 * console. Per business, only its name, plan, billing state and dates.
 * Bookings, AI use and failures arrive here already summed over every
 * business; no figure below can be traced to one of them.
 *
 * Pure: the route gathers the rows, this works out the figures. Dates are
 * UTC calendar periods.
 */

export type OverviewUnit = 'week' | 'month' | 'quarter' | 'year';

export interface OverviewTenant {
  id: string;
  name: string;
  createdAt: string;
  plan: TenantPlan;
  status: string;
  freeAccess: boolean;
  founding: boolean;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
}

export interface OverviewInput {
  now: Date;
  unit: OverviewUnit;
  offset: number;
  tenants: OverviewTenant[];
  /** Billing history (migration 0040), oldest first; null before it exists. */
  events: BillingEventRow[] | null;
  /** Summed over every business, for this period and the one before. */
  activity: { bookings: number; prevBookings: number; businessesBooked: number; prevBusinessesBooked: number };
  /** This calendar month, summed over every business. */
  ai: Array<{ kind: AiUsageKind; used: number; businessesAtLimit: number }>;
  failures: { emails: number; calendar: number };
  foundingSeats: number;
}

export interface Range {
  from: Date;
  to: Date;
}

export interface Period extends Range {
  unit: OverviewUnit;
  offset: number;
  label: string;
  previous: Range;
  current: boolean;
}

const PAYING: BillingEventState[] = ['active', 'past_due'];

/** The calendar week, month, quarter or year `offset` periods back, in UTC. */
export function overviewPeriod(unit: OverviewUnit, offset: number, now: Date): Period {
  const base = DateTime.fromJSDate(now, { zone: 'utc' });
  const start = base.startOf(unit).minus({ [`${unit}s`]: offset });
  const end = start.plus({ [`${unit}s`]: 1 });
  const prevStart = start.minus({ [`${unit}s`]: 1 });
  const label =
    unit === 'week'
      ? `Week of ${start.toFormat('d LLL yyyy')}`
      : unit === 'month'
        ? start.toFormat('LLLL yyyy')
        : unit === 'quarter'
          ? `Q${start.quarter} ${start.year}`
          : String(start.year);
  return {
    unit,
    offset,
    label,
    from: start.toJSDate(),
    to: end.toJSDate(),
    previous: { from: prevStart.toJSDate(), to: start.toJSDate() },
    current: offset === 0,
  };
}

const priceOf = (founding: boolean) => (founding ? FOUNDING_PRICE_MINOR : STANDARD_PRICE_MINOR);

const inRange = (iso: string | null, r: Range) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= r.from.getTime() && t < r.to.getTime();
};

/** Each business's history, oldest first. */
function byTenant(events: BillingEventRow[]): Map<string, BillingEventRow[]> {
  const map = new Map<string, BillingEventRow[]>();
  for (const e of events) {
    const list = map.get(e.tenant_id) ?? [];
    list.push(e);
    map.set(e.tenant_id, list);
  }
  return map;
}

/** A business's state at a moment, from its history; null if not yet recorded then. */
function stateAt(history: BillingEventRow[], at: Date): BillingEventRow | null {
  let found: BillingEventRow | null = null;
  for (const e of history) {
    if (new Date(e.occurred_at).getTime() <= at.getTime()) found = e;
    else break;
  }
  return found;
}

/** Paying businesses and monthly revenue at a moment, from the history. */
function payingAt(histories: Map<string, BillingEventRow[]>, at: Date) {
  let count = 0;
  let minor = 0;
  for (const history of histories.values()) {
    const s = stateAt(history, at);
    if (s && PAYING.includes(s.state)) {
      count += 1;
      minor += priceOf(s.founding);
    }
  }
  return { count, minor };
}

export function consoleOverview(input: OverviewInput) {
  const { now, tenants, events } = input;
  const period = overviewPeriod(input.unit, input.offset, now);
  const live = tenants.filter((t) => t.status !== 'deleted');
  const stateOf = (t: OverviewTenant) =>
    billingState({ plan: t.plan, free_access: t.freeAccess, subscription_status: t.subscriptionStatus });

  const histories = events ? byTenant(events) : null;
  const historySince = events && events.length > 0 ? new Date(events[0]!.occurred_at) : null;
  const covered = (at: Date) => !!historySince && at.getTime() >= historySince.getTime();
  // The end of a period that is still running is now.
  const endOf = (r: Range) => (r.to.getTime() > now.getTime() ? now : r.to);

  /* 1. Paying businesses and monthly revenue: as of the period's end. */
  const payingNow = live.filter((t) => PAYING.includes(stateOf(t) as BillingEventState));
  const current = period.current
    ? {
        count: payingNow.length,
        minor: payingNow.reduce((sum, t) => sum + priceOf(t.founding), 0),
        founding: payingNow.filter((t) => t.founding).length,
      }
    : histories && covered(endOf(period))
      ? { ...payingAt(histories, endOf(period)), founding: null }
      : null;
  const before = histories && covered(period.previous.to) ? payingAt(histories, period.previous.to) : null;

  /* 2. Sign-ups: every business made in the period, deleted ones included. */
  const known = new Map<string, string>();
  for (const t of tenants) known.set(t.id, t.createdAt);
  for (const e of events ?? []) if (!known.has(e.tenant_id)) known.set(e.tenant_id, e.tenant_created_at);
  const created = [...known.values()];
  const signups = created.filter((c) => inRange(c, period)).length;
  const prevSignups = created.filter((c) => inRange(c, period.previous)).length;

  /* 3. Trials that ended in the period, and how many of them pay. */
  const everPaid = (id: string) => !!histories?.get(id)?.some((e) => PAYING.includes(e.state));
  const ended = live.filter((t) => !t.freeAccess && inRange(t.trialEndsAt, period) && t.trialEndsAt! <= now.toISOString());
  const converted = ended.filter((t) => PAYING.includes(stateOf(t) as BillingEventState) || everPaid(t.id)).length;

  /* 4. Lost: cancelled or deleted in the period, from the history. */
  const changes = (events ?? []).filter((e) => !e.backfilled);
  const lost = histories
    ? {
        cancelled: changes.filter((e) => e.state === 'cancelled' && inRange(e.occurred_at, period)).length,
        deleted: changes.filter((e) => e.state === 'deleted' && inRange(e.occurred_at, period)).length,
        complete: covered(period.from),
      }
    : null;

  /* Needs you: account facts only. */
  const weekAhead = now.getTime() + 7 * 86_400_000;
  const trialsEnding = live
    .filter((t) => stateOf(t) === 'trial' && t.trialEndsAt)
    .filter((t) => {
      const end = new Date(t.trialEndsAt!).getTime();
      return end >= now.getTime() && end <= weekAhead;
    })
    .sort((a, b) => a.trialEndsAt!.localeCompare(b.trialEndsAt!))
    .map((t) => ({ id: t.id, name: t.name, endsAt: t.trialEndsAt! }));
  const paymentFailed = live.filter((t) => stateOf(t) === 'past_due').map((t) => ({ id: t.id, name: t.name }));

  /* Monthly revenue over the last 12 months, from the history. */
  const revenue: Array<{ month: string; minor: number; paying: number }> = [];
  if (histories && historySince) {
    const thisMonth = DateTime.fromJSDate(now, { zone: 'utc' }).startOf('month');
    for (let i = 11; i >= 0; i -= 1) {
      const m = thisMonth.minus({ months: i });
      const at = i === 0 ? now : m.plus({ months: 1 }).toJSDate();
      if (!covered(at)) continue;
      const p = payingAt(histories, at);
      revenue.push({ month: m.toFormat('yyyy-LL'), minor: p.minor, paying: p.count });
    }
  }

  /* Of the businesses that signed up each month, how many pay 1, 2, 3 months on. */
  const cohorts: Array<{ month: string; signedUp: number; paying: Array<number | null | 'unknown'> }> = [];
  {
    const thisMonth = DateTime.fromJSDate(now, { zone: 'utc' }).startOf('month');
    for (let i = 5; i >= 0; i -= 1) {
      const m = thisMonth.minus({ months: i });
      const members = [...known.entries()].filter(([, c]) => {
        const d = DateTime.fromISO(c, { zone: 'utc' });
        return d >= m && d < m.plus({ months: 1 });
      });
      const paying = [1, 2, 3].map((n) => {
        // Not there yet: some business from this month is under n months old.
        const reached = members.every(([, c]) => DateTime.fromISO(c, { zone: 'utc' }).plus({ months: n }).toJSDate() <= now);
        if (members.length === 0 || !reached) return null;
        if (!histories) return 'unknown' as const;
        let count = 0;
        for (const [id, c] of members) {
          const at = DateTime.fromISO(c, { zone: 'utc' }).plus({ months: n }).toJSDate();
          if (!covered(at)) return 'unknown' as const;
          const s = stateAt(histories.get(id) ?? [], at);
          if (s && PAYING.includes(s.state)) count += 1;
        }
        return count;
      });
      cohorts.push({ month: m.toFormat('yyyy-LL'), signedUp: members.length, paying });
    }
  }

  const foundingTaken = tenants.filter((t) => t.founding).length;

  return {
    period: { unit: period.unit, offset: period.offset, label: period.label, current: period.current },
    lines: {
      paying: { now: current?.count ?? null, before: before?.count ?? null },
      revenue: {
        now: current?.minor ?? null,
        before: before?.minor ?? null,
        founding: current?.founding ?? null,
      },
      signups: { now: signups, before: prevSignups },
      trials: { ended: ended.length, converted },
      lost,
    },
    needs: { trialsEnding, paymentFailed },
    activity: {
      ...input.activity,
      activeBusinesses: live.filter((t) => ['trial', 'active', 'past_due', 'free'].includes(stateOf(t))).length,
    },
    founding: { taken: foundingTaken, seats: input.foundingSeats },
    costs: { ai: input.ai, failures: input.failures },
    history: { since: historySince?.toISOString() ?? null, revenue, cohorts },
  };
}

export type ConsoleOverview = ReturnType<typeof consoleOverview>;
