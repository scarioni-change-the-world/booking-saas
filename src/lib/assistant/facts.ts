import { DateTime } from 'luxon';
import type { TenantScope } from '../db';
import type { DateOverrideRow, TenantRow, TenantSettingsRow } from '../db/types';
import { DEFAULT_CURRENCY, minorUnitDigits } from '../money';
import { loadSetupFacts } from '../setup-facts';
import { hoursSummary, setupItems } from '../setup';

/**
 * What "Ask khloe" may know about this business when answering: its setup,
 * never its clients. Service names, prices, hours, days off, rules,
 * whether the calendar and payments are connected, how far setup has got,
 * and how many appointments are coming up as a number. No client's name,
 * address, answer or message is read here, so none can reach the model.
 */
export async function loadAssistantFacts(tenant: TenantRow, scope: TenantScope) {
  const today = DateTime.now().setZone(tenant.timezone);
  const todayIso = today.toISODate()!;
  const horizon = today.plus({ days: 180 }).toISODate()!;

  const [setup, settings, overrides, calendar, upcoming, anyBooking] = await Promise.all([
    loadSetupFacts(scope),
    scope.select('tenant_settings').maybeSingle(),
    scope.select('date_overrides').gte('date', todayIso).lte('date', horizon).order('date', { ascending: true }),
    scope.select('calendar_connections', 'status').maybeSingle(),
    scope
      .select('bookings', 'id')
      .eq('status', 'confirmed')
      .gte('starts_at', today.toUTC().toISO()!)
      .lt('starts_at', today.plus({ days: 14 }).toUTC().toISO()!),
    scope.select('bookings', 'id').limit(1),
  ]);

  const s = (settings.data ?? null) as unknown as TenantSettingsRow | null;
  const currency = s?.currency ?? DEFAULT_CURRENCY;
  const digits = minorUnitDigits(currency);
  const days = (overrides.data ?? []) as unknown as DateOverrideRow[];
  const calendarStatus =
    ((calendar.data ?? null) as { status?: 'active' | 'needs_reconnect' | 'revoked' } | null)?.status ?? 'not_connected';

  // Every service not deleted, paused ones included (they can be resumed).
  const services = setup.services;
  const checklist = setupItems({
    services: setup.services,
    hours: setup.hours,
    calendarStatus,
    branding: { logo: !!tenant.branding?.logoUrl, colour: !!tenant.branding?.accentColor },
    everBooked: !anyBooking.error && (anyBooking.data ?? []).length > 0,
    embedded: false,
  });

  return {
    serviceIds: setup.services.map((x) => x.id),
    today: todayIso,
    facts: {
      business: {
        name: tenant.name,
        bookingPage: `/${tenant.slug}`,
        timeZone: tenant.timezone,
        today: `${today.toFormat('cccc d LLLL yyyy')} (${todayIso})`,
        currency,
      },
      services: services.map((x) => ({
        id: x.id,
        name: x.name,
        minutes: x.durationMinutes,
        price: x.priceMinor === null ? null : x.priceMinor / 10 ** digits,
        programmeSessions: x.bookingMode === 'pack' ? x.packSize : null,
        status: !x.active ? 'paused' : x.availableToProspects || x.availableToExistingClients ? 'taking bookings' : 'not finished yet (not offered)',
        offeredTo: [x.availableToProspects && 'new clients (booking page)', x.availableToExistingClients && 'existing clients (own link)']
          .filter(Boolean)
          .join(' and ') || 'nobody',
        ownQuestions: x.ownQuestionCount,
      })),
      sharedQuestions: setup.globalQuestionCount,
      usualWeeklyHours: hoursSummary(setup.hours),
      daysClosedAhead: days.filter((d) => d.is_closed).map((d) => d.date),
      datesWithTheirOwnHours: days
        .filter((d) => !d.is_closed)
        .map((d) => `${d.date} ${d.start_time?.slice(0, 5)}–${d.end_time?.slice(0, 5)}`),
      bookingRules: s
        ? { minimumNoticeHours: s.booking_notice_hours, bookableUpToDaysAhead: s.booking_window_days }
        : null,
      calendar: calendarStatus,
      look: { logo: !!tenant.branding?.logoUrl, colour: !!tenant.branding?.accentColor, website: tenant.branding?.websiteUrl ?? null },
      takesOnlinePayments: !!tenant.stripe_charges_enabled,
      appointmentsInNext14Days: (upcoming.data ?? []).length,
      setupChecklist: checklist.map((i) => `${i.title}: ${i.state}`),
    },
  };
}
