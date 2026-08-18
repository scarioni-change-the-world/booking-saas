import { tenantScope } from '../db';
import type { CalendarConnectionRow } from '../db/types';
import { GoogleCalendarProvider } from './google';
import { NoCalendarProvider } from './none';
import { CalendarUnavailableError, type CalendarProvider } from './provider';

export * from './provider';
export { NoCalendarProvider } from './none';
export {
  GoogleCalendarProvider,
  GoogleGrantExpiredError,
  GOOGLE_SCOPES,
  exchangeCodeForTokens,
  fetchAccountEmail,
} from './google';

/**
 * Resolve the calendar provider for a tenant.
 *
 * The distinction that matters here is between a tenant who never connected a
 * calendar and one whose connection is broken. They are NOT the same situation
 * and must not resolve to the same provider:
 *
 *   - No connection row: the tenant books without a calendar, deliberately.
 *     NoCalendarProvider is the correct behaviour, not a degraded one.
 *
 *   - A row in needs_reconnect or revoked: the tenant believes their calendar
 *     is connected and their real diary is not being consulted. Falling back to
 *     NoCalendarProvider here would keep serving slots with no conflict
 *     checking — precisely the silent degradation brief 6.8 describes, where
 *     the app kept taking bookings against a dead integration and nothing
 *     errored anywhere. So this throws, the booking path returns 503, and the
 *     tenant is told to reconnect.
 */
export async function providerForTenant(tenantId: string): Promise<CalendarProvider> {
  const scope = tenantScope(tenantId);

  const { data, error } = await scope.select('calendar_connections').maybeSingle();
  if (error) throw error;

  const connection = data as unknown as CalendarConnectionRow | null;
  if (!connection) return new NoCalendarProvider();

  if (connection.status !== 'active') {
    throw new CalendarUnavailableError(
      `Calendar connection for ${connection.account_email} is ${connection.status}; it must be reconnected.`,
      connection.provider,
    );
  }

  switch (connection.provider) {
    case 'google':
      return new GoogleCalendarProvider(connection, scope);
    default:
      // Microsoft 365 lands here (brief 7.6). Until then an unknown provider
      // must not silently behave as "no calendar" for a tenant who believes
      // theirs is connected.
      throw new Error(`Unsupported calendar provider: ${connection.provider}`);
  }
}
