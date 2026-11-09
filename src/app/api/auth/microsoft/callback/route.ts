import { NextResponse } from 'next/server';
import { exchangeMicrosoftCode, fetchMicrosoftEmail } from '@/lib/calendar';
import { saveConnection } from '@/lib/calendar/connections';
import { baseUrl } from '@/lib/base-url';
import { encryptSecret, verifyState } from '@/lib/crypto';
import { tenantScope } from '@/lib/db';
import type { CalendarConnectionRow } from '@/lib/db/types';

/**
 * Microsoft's OAuth callback, for Outlook and Microsoft 365 calendars. The
 * same shape as Google's: the signed state names the business and is the
 * only authorization a browser redirect can carry.
 */
function weekUrl(slug: string | null, params: Record<string, string>): string {
  const base = baseUrl();
  const url = new URL(slug ? `/admin/${slug}/week` : '/', base || 'http://localhost:3000');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const state = params.get('state');
  const code = params.get('code');
  const oauthError = params.get('error');

  const payload = state ? verifyState<{ tenantId: string; slug: string; provider?: string }>(state) : null;
  if (!payload || payload.provider !== 'microsoft') {
    return NextResponse.redirect(weekUrl(null, { calendar: 'error', reason: 'state' }));
  }
  if (oauthError || !code) {
    return NextResponse.redirect(weekUrl(payload.slug, { calendar: 'error', reason: oauthError ?? 'no_code' }));
  }

  try {
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
    if (!redirectUri) throw new Error('MICROSOFT_REDIRECT_URI must be set');

    const tokens = await exchangeMicrosoftCode(code, redirectUri);
    if (!tokens.refresh_token) {
      return NextResponse.redirect(weekUrl(payload.slug, { calendar: 'error', reason: 'no_refresh_token' }));
    }

    // The calendar permission is the one khloe cannot work without.
    const granted = (tokens.scope ?? '').split(' ').filter(Boolean);
    if (!granted.some((s) => s.toLowerCase().endsWith('calendars.readwrite'))) {
      return NextResponse.redirect(weekUrl(payload.slug, { calendar: 'error', reason: 'missing_scopes' }));
    }

    const row: Partial<CalendarConnectionRow> = {
      account_email: await fetchMicrosoftEmail(tokens.access_token),
      calendar_id: 'primary',
      refresh_token_encrypted: encryptSecret(tokens.refresh_token),
      access_token_encrypted: encryptSecret(tokens.access_token),
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      granted_scopes: granted,
      status: 'active',
      last_error: null,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await saveConnection(tenantScope(payload.tenantId), 'microsoft', row);
    return NextResponse.redirect(weekUrl(payload.slug, { calendar: 'connected' }));
  } catch (cause) {
    console.error('[microsoft] callback failed:', cause);
    return NextResponse.redirect(weekUrl(payload.slug, { calendar: 'error', reason: 'exchange_failed' }));
  }
}
