import { DateTime } from 'luxon';
import { fail, handleError, ok, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { aiProvider } from '@/lib/ai';
import { assertUnderMonthlyLimit, recordUsage } from '@/lib/ai/usage';
import { loadReportInput } from '@/lib/report-data';
import { previousPeriod, resolvePeriod } from '@/lib/report-period';
import { buildReport } from '@/lib/reports';
import { summaryFacts } from '@/lib/reports-summary';

/**
 * Draft the written summary for a period, and keep it: opening the same
 * period again shows it without asking (or paying) twice. Asking again for a
 * period that has one replaces it — the figures may have moved since.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const body = await readJson(request);
    const today = DateTime.now().setZone(tenant.timezone).toISODate()!;
    const period = resolvePeriod(typeof body.preset === 'string' ? body.preset : null, today, {
      from: typeof body.from === 'string' ? body.from : null,
      to: typeof body.to === 'string' ? body.to : null,
    });
    if ('error' in period) return fail(period.error, 400);

    await assertUnderMonthlyLimit(scope, 'report_summary');
    const { input, currency } = await loadReportInput(tenant, scope, period, previousPeriod(period));
    const report = buildReport(input, currency);
    if (
      report.headline.bookingsMade.value +
        report.headline.sessionsHeld.value +
        report.funnel.steps[0]!.count ===
      0
    ) {
      return fail('There is nothing in this period to write about yet.', 409);
    }

    const summary = await aiProvider().summariseReport({
      businessName: tenant.name,
      periodLabel: period.label,
      facts: summaryFacts(report, currency),
    });
    await recordUsage(scope, 'report_summary');

    const removed = await scope
      .delete('report_summaries')
      .eq('period_from', period.from)
      .eq('period_to', period.to);
    if (removed.error && removed.error.code !== '42P01' && removed.error.code !== 'PGRST205')
      throw removed.error;
    const saved = await scope.insert('report_summaries', {
      period_from: period.from,
      period_to: period.to,
      summary,
    });
    if (saved.error && saved.error.code !== '42P01' && saved.error.code !== 'PGRST205') throw saved.error;

    return ok({ summary: { summary, created_at: new Date().toISOString() } });
  } catch (error) {
    return handleError(error);
  }
}
