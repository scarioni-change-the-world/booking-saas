import { DateTime } from 'luxon';
import { handleError, ok } from '@/lib/api';
import { requirePlatformStaff } from '@/lib/auth';
import { listAllTenants, loadPlatformTotals, loadSiteRows } from '@/lib/db/console';
import { siteSummary } from '@/lib/site-hits';
import { listBillingEvents } from '@/lib/db/billing-events';
import { consoleOverview, MAX_CUSTOM_DAYS, periodFor, type OverviewUnit } from '@/lib/console-overview';
import { BookingError } from '@/lib/booking-service';
import { MONTHLY_LIMITS } from '@/lib/ai/limits';
import { foundingSeats } from '@/lib/plans';
import type { AiUsageKind } from '@/lib/db/types';

const UNITS: OverviewUnit[] = ['week', 'month', 'quarter', 'year'];

/**
 * The console's Overview: how the khloe business is doing.
 * ?unit=week|month|quarter|year&offset=0 (periods back), or
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD (any two days, both included).
 *
 * Account and billing facts, and platform-wide totals; nothing from inside
 * a business (console-overview.ts). Any staff member may look.
 */
export async function GET(request: Request) {
  try {
    await requirePlatformStaff(request);
    const params = new URL(request.url).searchParams;
    const asked = params.get('unit') as OverviewUnit | null;
    const unit: OverviewUnit = asked && UNITS.includes(asked) ? asked : 'month';
    const offset = Math.min(Math.max(Number.parseInt(params.get('offset') ?? '0', 10) || 0, 0), 520);

    const now = new Date();
    // ?from=YYYY-MM-DD&to=YYYY-MM-DD, both days included, replaces unit and offset.
    const from = params.get('from');
    const to = params.get('to');
    const custom = from || to ? { from: from ?? '', to: to ?? '' } : undefined;
    const period = periodFor({ unit, offset, custom, now });
    if (!period) {
      throw new BookingError(
        `Choose two days, the first no later than the second and not in the future, at most ${MAX_CUSTOM_DAYS} days apart.`,
        400,
      );
    }
    const monthStart = DateTime.fromJSDate(now, { zone: 'utc' }).startOf('month').toJSDate();

    const [tenants, events, totals, siteRows] = await Promise.all([
      listAllTenants(),
      listBillingEvents(),
      loadPlatformTotals({ range: period, previous: period.previous, monthStart }),
      loadSiteRows(period, period.previous),
    ]);

    // AI use this month, summed per feature; per business only to count those at the limit.
    const perTenant = new Map<string, number>();
    const used = new Map<AiUsageKind, number>();
    for (const row of totals.aiRows) {
      used.set(row.kind, (used.get(row.kind) ?? 0) + 1);
      const key = `${row.kind}:${row.tenant_id}`;
      perTenant.set(key, (perTenant.get(key) ?? 0) + 1);
    }
    const ai = (Object.keys(MONTHLY_LIMITS) as AiUsageKind[]).map((kind) => ({
      kind,
      used: used.get(kind) ?? 0,
      businessesAtLimit: [...perTenant.entries()].filter(
        ([key, n]) => key.startsWith(`${kind}:`) && n >= MONTHLY_LIMITS[kind],
      ).length,
    }));

    const overview = consoleOverview({
      now,
      unit,
      offset,
      custom,
      tenants: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        createdAt: t.created_at,
        plan: t.plan,
        status: t.status,
        freeAccess: t.free_access,
        founding: !!t.founding,
        subscriptionStatus: t.subscription_status ?? null,
        trialEndsAt: t.trial_ends_at,
      })),
      events,
      activity: totals.activity,
      ai,
      failures: totals.failures,
      foundingSeats: foundingSeats(),
    });
    // khloe.io's own counter (migration 0041); null before it exists.
    const site = siteRows ? siteSummary(siteRows.rows, siteRows.previous) : null;
    return ok({ overview, site });
  } catch (error) {
    return handleError(error);
  }
}
