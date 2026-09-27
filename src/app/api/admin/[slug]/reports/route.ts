import { DateTime } from 'luxon';
import { fail, handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { loadReportInput } from '@/lib/report-data';
import { previousPeriod, rangeLabel, resolvePeriod } from '@/lib/report-period';
import { buildReport } from '@/lib/reports';

/**
 * A report for one period: ?preset=7d|30d|month|last-month|90d|year, or
 * ?preset=custom&from=yyyy-MM-dd&to=yyyy-MM-dd. With the period before it
 * for comparison, and the written summary when one was already drafted.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const params = new URL(request.url).searchParams;
    const today = DateTime.now().setZone(tenant.timezone).toISODate()!;
    const period = resolvePeriod(params.get('preset'), today, {
      from: params.get('from'),
      to: params.get('to'),
    });
    if ('error' in period) return fail(period.error, 400);
    const previous = previousPeriod(period);

    const { input, currency, visitsSince } = await loadReportInput(tenant, scope, period, previous);
    const report = buildReport(input, currency);

    const saved = await scope
      .select('report_summaries', 'summary, created_at')
      .eq('period_from', period.from)
      .eq('period_to', period.to)
      .maybeSingle();

    return ok({
      today,
      period,
      previous: { ...previous, label: rangeLabel(previous.from, previous.to, today) },
      currency,
      timezone: tenant.timezone,
      visitsSince,
      report,
      summary: saved.error || !saved.data ? null : saved.data,
    });
  } catch (error) {
    return handleError(error);
  }
}
