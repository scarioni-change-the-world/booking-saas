import { fail, handleError, ok, readJson } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { GOOGLE_SCOPES, MICROSOFT_AUTH_URL, MICROSOFT_SCOPES, microsoftConfigured, providerForTenant } from '@/lib/calendar';
import { revokeGrant } from '@/lib/calendar/connections';
import { signState } from '@/lib/crypto';
import type { CalendarConnectionRow } from '@/lib/db/types';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REDIRECT_URI);
}

/**
 * Calendar connection status for the dashboard: which calendar (Google or
 * Outlook), and whether it really works.
 *
 * Performs a real health check rather than reporting on the presence of a row.
 * Brief 6.8: the reference implementation showed "Connected" whenever an email
 * string existed in the database, so a dead integration looked healthy
 * indefinitely — while the app quietly served unchecked times and dropped
 * video links from emails.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);
    const available = { google: googleConfigured(), microsoft: microsoftConfigured() };

    const { data, error } = await scope.select('calendar_connections').limit(1).maybeSingle();
    if (error) throw error;

    const connection = data as unknown as CalendarConnectionRow | null;
    if (!connection) {
      return ok({ connected: false, status: 'not_connected' as const, provider: null, health: null, available });
    }

    const provider = await providerForTenant(tenant.id).catch(() => null);
    const health = provider
      ? await provider.healthCheck()
      : { connected: false, accountEmail: connection.account_email, checkedAt: new Date().toISOString() };

    return ok({
      connected: health.connected,
      status: connection.status,
      provider: connection.provider,
      accountEmail: connection.account_email,
      calendarId: connection.calendar_id,
      grantedScopes: connection.granted_scopes,
      health,
      available,
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Begin connecting a calendar: { provider: 'google' | 'microsoft' }.
 *
 * Returns the consent URL instead of redirecting, because this endpoint is
 * authenticated by a bearer token and a top-level browser navigation cannot
 * carry one. The dashboard fetches the URL with its session and then
 * navigates there.
 *
 * Google: `prompt=consent` with `access_type=offline` guarantees a refresh
 * token. Microsoft: `offline_access` in the scopes does the same, and
 * `prompt=select_account` lets someone signed in to two Microsoft accounts
 * pick the right one.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant } = await requireTenantAdmin(request, slug);
    const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
    const which = body.provider === 'microsoft' ? 'microsoft' : 'google';

    if (which === 'microsoft') {
      if (!microsoftConfigured()) return fail('Outlook calendars are not set up yet.', 503);
      const url = new URL(MICROSOFT_AUTH_URL);
      url.searchParams.set('client_id', process.env.MICROSOFT_CLIENT_ID ?? '');
      url.searchParams.set('redirect_uri', process.env.MICROSOFT_REDIRECT_URI ?? '');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('response_mode', 'query');
      url.searchParams.set('scope', MICROSOFT_SCOPES.join(' '));
      url.searchParams.set('prompt', 'select_account');
      url.searchParams.set('state', signState({ tenantId: tenant.id, slug: tenant.slug, provider: 'microsoft' }));
      return ok({ url: url.toString() });
    }

    // Google isn't wired up in every environment — say so plainly instead
    // of letting this fall through to a generic 500 further down.
    if (!googleConfigured()) return fail('Google Calendar is not set up yet.', 503);
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID ?? '');
    url.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI ?? '');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'false');
    url.searchParams.set('state', signState({ tenantId: tenant.id, slug: tenant.slug, provider: 'google' }));
    return ok({ url: url.toString() });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Disconnect.
 *
 * Deletes the stored grant, which is what the privacy policy promises. Google
 * is asked to revoke it too, but a revoke failure does not prevent the local
 * delete: the business asked us to stop holding their credentials, and
 * holding them because a provider was unreachable would be the wrong way round.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { data, error: readError } = await scope.select('calendar_connections');
    if (readError) throw readError;
    for (const connection of (data ?? []) as unknown as CalendarConnectionRow[]) {
      await revokeGrant(connection);
      const { error } = await scope.delete('calendar_connections').eq('id', connection.id);
      if (error) throw error;
    }
    return ok({ connected: false });
  } catch (error) {
    return handleError(error);
  }
}
