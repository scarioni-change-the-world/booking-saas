import { NoCalendarProvider } from './none';
import type { CalendarProvider } from './provider';

export * from './provider';
export { NoCalendarProvider } from './none';

/**
 * Resolve the calendar provider for a tenant.
 *
 * Google lands here next, keyed on a per-tenant connection row. Read brief
 * 6.1-6.7 before writing it — in particular: call the REST endpoints with
 * native fetch and never add the `googleapis` package (114 MB, 120-second cold
 * starts), and read conferenceData.entryPoints[] rather than hangoutLink alone.
 */
export async function providerForTenant(_tenantId: string): Promise<CalendarProvider> {
  return new NoCalendarProvider();
}
