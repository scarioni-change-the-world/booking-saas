import { fail, handleError, ok } from '@/lib/api';
import { requireTenantAdmin } from '@/lib/auth';
import { GOOGLE_SCOPES, providerForTenant } from '@/lib/calendar';
import { signState } from '@/lib/crypto';
import type { CalendarConnectionRow } from '@/lib/db/types';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

function redirectUri(): string {
  const uri = process.env.GOOGLE_REDIRECT_URI;
  if (!uri) throw new Error('GOOGLE_REDIRECT_URI must be set');
  return uri;
}

/**
 * Calendar connection status for the dashboard.
 *
 * Performs a real health check rather than reporting on the presence of a row.
 * Brief 6.8: the reference implementation showed "Connected" whenever an email
 * string existed in the database, so a dead integration looked healthy
 * indefinitely — while the app quietly served unchecked times and dropped Meet
 * links from emails.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant, scope } = await requireTenantAdmin(request, slug);

    const { data, error } = await scope.select('calendar_connections').maybeSingle();
    if (error) throw error;

    const connection = data as unknown as CalendarConnectionRow | null;
    if (!connection) {
      return ok({ connected: false, status: 'not_connected' as const, health: null });
    }

    const provider = await providerForTenant(tenant.id);
    const health = await provider.healthCheck();

    return ok({
      connected: health.connected,
      status: connection.status,
      accountEmail: connection.account_email,
      calendarId: connection.calendar_id,
      grantedScopes: connection.granted_scopes,
      health,
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Begin the OAuth flow.
 *
 * Returns the consent URL instead of redirecting, because this endpoint is
 * authenticated by a bearer token and a top-level browser navigation cannot
 * carry one. The dashboard fetches the URL with its session and then navigates
 * to Google directly.
 *
 * `prompt=consent` with `access_type=offline` is what guarantees a refresh
 * token comes back. Without it Google omits the refresh token on every consent
 * after the first, and the connection silently becomes unrenewable.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { tenant } = await requireTenantAdmin(request, slug);

    // Google isn't wired up yet in every environment — say so plainly instead
    // of letting this fall through to a generic 500 further down.
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
      return fail('Google Calendar is not set up yet.', 503);
    }

    const state = signState({ tenantId: tenant.id, slug: tenant.slug });

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID ?? '');
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'false');
    url.searchParams.set('state', state);

    return ok({ url: url.toString() });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Disconnect.
 *
 * Deletes the stored grant, which is what the public homepage promises. Google
 * is asked to revoke it too, but a revoke failure does not prevent the local
 * delete: the tenant asked us to stop holding their credentials, and holding
 * them because Google was unreachable would be the wrong way round.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const { scope } = await requireTenantAdmin(request, slug);

    const { data } = await scope.select('calendar_connections').maybeSingle();
    const connection = data as unknown as CalendarConnectionRow | null;

    if (connection) {
      const { decryptSecret } = await import('@/lib/crypto');
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: decryptSecret(connection.refresh_token_encrypted),
          }),
        });
      } catch (cause) {
        console.warn('[google] revoke failed, deleting local grant anyway:', cause);
      }

      const { error } = await scope.delete('calendar_connections').eq('id', connection.id);
      if (error) throw error;
    }

    return ok({ connected: false });
  } catch (error) {
    return handleError(error);
  }
}
