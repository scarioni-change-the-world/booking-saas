import { handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { serializeEmailTemplate, serializeOutcomePath } from '@/lib/admin-serializers';
import { emailProvider } from '@/lib/email';
import { tallySends, type SendRow } from '@/lib/messages';
import type {
  EmailSendRow,
  EmailTemplateRow,
  OutcomePathRow,
  TenantSettingsRow,
} from '@/lib/db/types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEND_LIMIT = 5000;
const PROBLEM_LIMIT = 8;

interface ProblemJoin extends Pick<EmailSendRow, 'id' | 'kind' | 'status' | 'error' | 'created_at'> {
  bookings: { name: string; email: string } | null;
  clients: { name: string; email: string } | null;
}

/**
 * Everything Messages reads, in one request: what each message says, and
 * over the last 30 days how many went out and which did not arrive.
 *
 * The 30 days match Overview and Enquiries, so "11 sent" here and "11 went
 * on to book" there can be read against each other.
 *
 * Saving goes through the existing email-templates and outcome-paths
 * routes: one way to change a message, however it is reached.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);

    const sinceIso = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

    const [templates, paths, sends, problems, shown, services, settings] = await Promise.all([
      scope.select('email_templates').order('kind', { ascending: true }),
      scope.select('outcome_paths'),
      scope.select('email_sends', 'kind, status').gte('created_at', sinceIso).limit(SEND_LIMIT),
      scope
        .select('email_sends', 'id, kind, status, error, created_at, bookings(name, email), clients(name, email)')
        .gte('created_at', sinceIso)
        .eq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(PROBLEM_LIMIT),
      scope
        .select('qualification_responses', 'id')
        .gte('started_at', sinceIso)
        .eq('outcome_path_type', 'other')
        .not('completed_at', 'is', null)
        .limit(SEND_LIMIT),
      scope.select('event_types', 'name').eq('active', true).order('sort_order', { ascending: true }).limit(1),
      scope.select('tenant_settings').maybeSingle(),
    ]);
    for (const result of [templates, paths, sends, problems, shown, services, settings]) {
      if (result.error) throw result.error;
    }

    const otherPath = ((paths.data ?? []) as unknown as OutcomePathRow[]).find((p) => p.type === 'other');
    const firstService = ((services.data ?? []) as unknown as Array<{ name: string }>)[0];

    return ok({
      tenantName: tenant.name,
      timezone: tenant.timezone,
      /* Whether this deployment can send email at all. Without it every
         count below is "not sent", and the screen says why once rather
         than seven times. */
      emailConfigured: emailProvider().id !== 'console',
      notificationEmail: (settings.data as unknown as TenantSettingsRow | null)?.notification_email ?? null,
      serviceName: firstService?.name ?? null,
      templates: ((templates.data ?? []) as unknown as EmailTemplateRow[]).map(serializeEmailTemplate),
      nextSteps: otherPath ? serializeOutcomePath(otherPath) : null,
      tallies: tallySends((sends.data ?? []) as unknown as SendRow[]),
      shownElsewhere: (shown.data ?? []).length,
      problems: ((problems.data ?? []) as unknown as ProblemJoin[]).map((p) => {
        const who = p.bookings ?? p.clients;
        return {
          id: p.id,
          kind: p.kind,
          at: p.created_at,
          error: p.error,
          name: who?.name ?? null,
          email: who?.email ?? null,
        };
      }),
    });
  } catch (error) {
    return handleError(error);
  }
}
