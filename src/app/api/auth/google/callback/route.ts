import { NextResponse } from 'next/server';
import { exchangeCodeForTokens, fetchAccountEmail, GOOGLE_SCOPES } from '@/lib/calendar';
import { encryptSecret, verifyState } from '@/lib/crypto';
import { tenantScope } from '@/lib/db';
import type { CalendarConnectionRow } from '@/lib/db/types';

/**
 * OAuth callback.
 *
 * Not authenticated by a session — Google redirects the browser here, and a
 * top-level navigation carries no bearer token. The signed `state` is the
 * authorization: it names the tenant this grant attaches to and cannot be
 * forged without APP_SECRET. Without that signature, anyone could hand a tenant
 * admin a start URL naming a different tenant and capture the resulting grant.
 */

function settingsUrl(slug: string | null, params: Record<string, string>): string {
  const base = process.env.PUBLIC_BASE_URL ?? '';
  const path = slug ? `/admin/${slug}/settings` : '/';
  const url = new URL(path, base || 'http://localhost:3000');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const state = params.get('state');
  const code = params.get('code');
  const oauthError = params.get('error');

  const payload = state
    ? verifyState<{ tenantId: string; slug: string }>(state)
    : null;

  // An unverifiable state is either a forged callback or one that expired while
  // the admin sat on the consent screen. Neither may write a connection.
  if (!payload) {
    return NextResponse.redirect(settingsUrl(null, { calendar: 'error', reason: 'state' }));
  }

  if (oauthError || !code) {
    return NextResponse.redirect(
      settingsUrl(payload.slug, { calendar: 'error', reason: oauthError ?? 'no_code' }),
    );
  }

  try {
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!redirectUri) throw new Error('GOOGLE_REDIRECT_URI must be set');

    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // No refresh token means the grant cannot be renewed and will stop working
    // within the hour. Google omits it when a prior consent is still live and
    // prompt=consent was not sent. Refuse the connection rather than storing
    // one that is already broken.
    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        settingsUrl(payload.slug, { calendar: 'error', reason: 'no_refresh_token' }),
      );
    }

    const grantedScopes = (tokens.scope ?? '').split(' ').filter(Boolean);

    // Brief 6.4: a token keeps the scopes it was granted with, and changing the
    // consent screen does not retroactively alter an existing one. A grant
    // missing a scope this app needs works for everything except the calls that
    // need it — so check at connect time, when the admin is present to fix it,
    // rather than discovering it weeks later on a booking.
    const required = GOOGLE_SCOPES.filter((s) => !s.endsWith('userinfo.email'));
    const missing = required.filter((scope) => !grantedScopes.includes(scope));
    if (missing.length > 0) {
      return NextResponse.redirect(
        settingsUrl(payload.slug, { calendar: 'error', reason: 'missing_scopes' }),
      );
    }

    const accountEmail = await fetchAccountEmail(tokens.access_token);
    const scope = tenantScope(payload.tenantId);

    const row: Partial<CalendarConnectionRow> = {
      provider: 'google',
      account_email: accountEmail,
      calendar_id: 'primary',
      refresh_token_encrypted: encryptSecret(tokens.refresh_token),
      access_token_encrypted: encryptSecret(tokens.access_token),
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      granted_scopes: grantedScopes,
      status: 'active',
      last_error: null,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // A reconnect replaces the previous grant. This is the path brief 6.3 says
    // to take once the OAuth app reaches Production: publishing does NOT extend
    // an already-issued token, so a tenant connected during Testing must
    // disconnect and reconnect once to get a durable one.
    const existing = await scope.select('calendar_connections').eq('provider', 'google').maybeSingle();
    if (existing.error) throw existing.error;

    const previous = existing.data as unknown as CalendarConnectionRow | null;
    const { error } = previous
      ? await scope.update('calendar_connections', row).eq('id', previous.id)
      : await scope.insert('calendar_connections', row);

    if (error) throw error;

    return NextResponse.redirect(settingsUrl(payload.slug, { calendar: 'connected' }));
  } catch (cause) {
    console.error('[google] callback failed:', cause);
    return NextResponse.redirect(
      settingsUrl(payload.slug, { calendar: 'error', reason: 'exchange_failed' }),
    );
  }
}
