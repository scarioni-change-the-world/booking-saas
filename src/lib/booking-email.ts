import { DateTime } from 'luxon';
import { baseUrl } from './base-url';
import { buildIcs, buildIcsCalendar } from './ics';
import { mapUrlForInvite } from './maps';
import { describeLocation } from './service-location';
import { emailProvider } from './email';
import { renderTemplate, type TemplateTokens, type TemplateLink } from './email/templates';
import type { TenantScope } from './db';
import type {
  BookingRow,
  ServiceLocationKind,
  EmailStatus,
  EmailTemplateKind,
  EmailTemplateRow,
  TenantRow,
  TenantSettingsRow,
} from './db/types';

/**
 * Sending the transactional emails a booking's lifecycle triggers — the
 * database-touching half, paired with the pure rendering in
 * src/lib/email/templates.ts the same way qualification-response-service.ts
 * pairs with qualification.ts.
 *
 * Every send here is best-effort and never throws out of this module: a
 * booking, reschedule or cancellation must always succeed on its own terms
 * (brief 6.9's lesson, already applied to calendar sync — see
 * booking-service.ts) even when the mail server is down. What email
 * actually happened is recorded on the booking row instead of being
 * silently swallowed.
 */

const PRODUCT_NAME = 'Intro';

interface ServiceFacts {
  name: string;
  locationKind: ServiceLocationKind | null;
  locationDetail: string | null;
}

async function loadServiceFacts(
  scope: TenantScope,
  eventTypeId: string,
): Promise<ServiceFacts> {
  // Not loadEventType (booking-service.ts) — that filters on active, and an
  // archived service's own past booking should still get a real name in its
  // emails, not a 404.
  const { data, error } = await scope
    .select('event_types', 'name, location_kind, location_detail')
    .eq('id', eventTypeId)
    .maybeSingle();
  if (error) throw error;

  const row = data as {
    name: string;
    location_kind: ServiceLocationKind | null;
    location_detail: string | null;
  } | null;

  return {
    name: row?.name ?? 'your session',
    locationKind: row?.location_kind ?? null,
    locationDetail: row?.location_detail ?? null,
  };
}

async function loadTenantSettings(scope: TenantScope): Promise<TenantSettingsRow | null> {
  const { data, error } = await scope.select('tenant_settings').maybeSingle();
  if (error) throw error;
  return data as unknown as TenantSettingsRow | null;
}

async function loadTemplate(scope: TenantScope, kind: EmailTemplateKind): Promise<EmailTemplateRow | null> {
  const { data, error } = await scope.select('email_templates').eq('kind', kind).maybeSingle();
  if (error) throw error;
  return data as unknown as EmailTemplateRow | null;
}

function formatDateTime(iso: string, zone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone).toFormat("cccc, LLLL d 'at' h:mm a");
}

function manageUrl(manageToken: string): string {
  return `${baseUrl()}/manage/${manageToken}`;
}

async function recordEmailStatus(
  scope: TenantScope,
  bookingId: string,
  status: EmailStatus,
  error?: string,
): Promise<void> {
  await scope
    .update('bookings', { email_status: status, email_error: error ?? null })
    .eq('id', bookingId);
}

interface ClientEmailOptions {
  includeIcs: boolean;
  includeManageLink: boolean;
}

/**
 * The client-facing send shared by all three lifecycle kinds — differing
 * only in which template, and whether an .ics and the manage link apply.
 * Its outcome is what email_status/email_error reflect: this is the
 * client's only channel for any of these, unlike the owner notification.
 */
async function sendClientEmail(
  tenant: TenantRow,
  scope: TenantScope,
  booking: BookingRow,
  kind: EmailTemplateKind,
  options: ClientEmailOptions,
): Promise<EmailStatus> {
  const [service, template, settings] = await Promise.all([
    loadServiceFacts(scope, booking.event_type_id),
    loadTemplate(scope, kind),
    loadTenantSettings(scope),
  ]);
  const serviceName = service.name;

  if (!template) {
    await recordEmailStatus(scope, booking.id, 'not_configured');
    return 'not_configured';
  }

  const dateTime = formatDateTime(booking.starts_at, tenant.timezone);
  const tokens: TemplateTokens = {
    clientName: booking.name,
    serviceName,
    dateTime,
    meetingLink: booking.meeting_url ?? '',
    tenantName: tenant.name,
  };

  // The video link is appended rather than left to the template for the same
  // reason the manage link is: it only sometimes exists. A booking has one
  // when the calendar provisioned a Meet room, and none when the tenant has
  // no calendar connected or the session is in person — so a {{meetingLink}}
  // sitting in the body renders as a dangling "Join here: " on every booking
  // that has no room. Appending it means it appears exactly when there is
  // something to join.
  //
  // Unless the tenant placed the token themselves, in which case they have
  // decided where it goes and repeating it underneath would be noise.
  const links: TemplateLink[] = [];
  if (booking.meeting_url && !template.body.includes('{{meetingLink}}')) {
    links.push({ label: 'Join the video call', url: booking.meeting_url });
  }
  if (options.includeManageLink) {
    links.push({ label: 'Change or cancel your booking', url: manageUrl(booking.manage_token) });
  }

  try {
    const rendered = renderTemplate(template, tokens, links);

    const attachments = options.includeIcs
      ? [
          {
            filename: 'invite.ics',
            content: buildIcs({
              uid: booking.id,
              summary: `${serviceName} — ${tenant.name}`,
              /* LOCATION is what a calendar app turns into a tappable row —
                 a map on a phone, a Join button for a URL. A video link takes
                 it when there is one; otherwise the address the business
                 wrote, which until now was simply missing from every
                 in-person invitation. */
              description: icsDescription(booking.meeting_url, service),
              location: booking.meeting_url ?? service.locationDetail ?? undefined,
              startsAt: booking.starts_at,
              endsAt: booking.ends_at,
              organizer: settings?.notification_email
                ? { name: tenant.name, email: settings.notification_email }
                : undefined,
              attendee: { name: booking.name, email: booking.email },
            }),
            contentType: 'text/calendar; method=PUBLISH',
          },
        ]
      : undefined;

    const provider = emailProvider();
    await provider.send({
      to: { name: booking.name, email: booking.email },
      fromName: tenant.name,
      replyTo: settings?.reply_to_email ?? undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments,
    });
    // ConsoleEmailProvider never throws — it logs and returns a fake id, so
    // a bare "did send() throw" check alone would record 'sent' for
    // something that never actually left the building. Its id is what
    // distinguishes a real send from the console fallback.
    const status: EmailStatus = provider.id === 'console' ? 'not_configured' : 'sent';
    await recordEmailStatus(scope, booking.id, status);
    return status;
  } catch (cause) {
    console.error(`[booking-email] ${kind} send failed:`, cause);
    await recordEmailStatus(scope, booking.id, 'failed', (cause as Error).message);
    return 'failed';
  }
}

/**
 * Owner notification — deliberately not reflected in email_status. The
 * tenant already sees the booking in their own dashboard whether or not
 * this arrives, so a failure here is logged, not recorded on the booking a
 * client has no part in.
 */
async function sendOwnerNotification(
  tenant: TenantRow,
  scope: TenantScope,
  booking: BookingRow,
  serviceName: string,
  dateTime: string,
  notificationEmail: string,
): Promise<void> {
  try {
    const template = await loadTemplate(scope, 'owner_notification');
    if (!template) return;

    const rendered = renderTemplate(template, {
      clientName: booking.name,
      clientEmail: booking.email,
      serviceName,
      dateTime,
      tenantName: tenant.name,
    });

    await emailProvider().send({
      to: { email: notificationEmail },
      fromName: PRODUCT_NAME,
      // The client's own address, not the tenant's reply-to setting — so
      // hitting reply on "you have a new booking" goes straight to the lead.
      replyTo: booking.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  } catch (cause) {
    console.error('[booking-email] owner notification failed:', cause);
  }
}

export async function sendBookingConfirmedEmail(
  tenant: TenantRow,
  scope: TenantScope,
  booking: BookingRow,
): Promise<EmailStatus> {
  // Returned so the caller can tell the person who just booked the truth.
  // The confirmation screen used to state that an email was on its way
  // regardless, which is right in production and a lie on any deployment
  // without a mail server — and a lie of exactly the wrong kind, since
  // someone who trusts it does not write the time down.
  //
  // The owner notification below deliberately does not affect this. It is a
  // different recipient with a different failure: a tenant who misses one
  // still sees the booking in their dashboard.
  const status = await sendClientEmail(tenant, scope, booking, 'booking_confirmed', {
    includeIcs: true,
    includeManageLink: true,
  });

  const settings = await loadTenantSettings(scope);
  if (settings?.notification_email) {
    const { name: serviceName } = await loadServiceFacts(scope, booking.event_type_id);
    const dateTime = formatDateTime(booking.starts_at, tenant.timezone);
    await sendOwnerNotification(tenant, scope, booking, serviceName, dateTime, settings.notification_email);
  }

  return status;
}

export async function sendBookingRescheduledEmail(
  tenant: TenantRow,
  scope: TenantScope,
  booking: BookingRow,
): Promise<void> {
  await sendClientEmail(tenant, scope, booking, 'booking_rescheduled', {
    includeIcs: true,
    includeManageLink: true,
  });
}

/**
 * The reminder, the day before.
 *
 * No .ics — they already have one from the confirmation, and a second
 * attachment for the same appointment invites a duplicate in their
 * calendar. The manage link is included, because "I need to move this" is
 * the most likely reason a reminder gets read at all, and making that easy
 * is worth more to the business than the reminder itself.
 */
export async function sendBookingReminderEmail(
  tenant: TenantRow,
  scope: TenantScope,
  booking: BookingRow,
): Promise<EmailStatus> {
  return sendClientEmail(tenant, scope, booking, 'booking_reminder', {
    includeIcs: false,
    includeManageLink: true,
  });
}

export async function sendBookingCancelledEmail(
  tenant: TenantRow,
  scope: TenantScope,
  booking: BookingRow,
): Promise<void> {
  await sendClientEmail(tenant, scope, booking, 'booking_cancelled', {
    includeIcs: false,
    includeManageLink: false,
  });
}

/**
 * Re-attempt the client email for a booking whose last one failed —
 * driven by the admin Bookings list. Not "replay whichever historical
 * send failed": there is only ever one current email_status per booking
 * (see migration 0017), so a retry re-derives which kind applies from the
 * booking's *current* state. For a confirmed booking that was rescheduled
 * since its original confirmation, that means re-sending the confirmation
 * template with the current time — which is also, correctly, a fresh
 * confirmation of wherever it now stands, not a lie.
 */
export async function retryBookingEmail(
  tenant: TenantRow,
  scope: TenantScope,
  booking: BookingRow,
): Promise<EmailStatus> {
  if (booking.status === 'cancelled') {
    await sendClientEmail(tenant, scope, booking, 'booking_cancelled', {
      includeIcs: false,
      includeManageLink: false,
    });
  } else {
    await sendClientEmail(tenant, scope, booking, 'booking_confirmed', {
      includeIcs: true,
      includeManageLink: true,
    });
  }

  const { data, error } = await scope.select('bookings', 'email_status').eq('id', booking.id).maybeSingle();
  if (error) throw error;
  return (data as { email_status: EmailStatus } | null)?.email_status ?? 'failed';
}

/**
 * What goes in the invitation's description.
 *
 * Calendar apps make LOCATION tappable on their own, but not consistently —
 * and a client reading the invitation on a laptop gets nothing from a bare
 * address. An explicit map link costs one line and works everywhere, so the
 * person who opens this on the morning of the appointment has one thing to
 * tap whatever they are holding.
 *
 * Google's URL rather than the device's likely preference: an invitation is
 * written once, on a server, and read on whatever the client opens it with —
 * which is often several devices, none of them the one they booked from.
 */
function icsDescription(
  meetingUrl: string | null,
  service: ServiceFacts,
): string | undefined {
  const lines: string[] = [];

  if (meetingUrl) lines.push(`Meeting link: ${meetingUrl}`);

  const described = describeLocation(service.locationKind, service.locationDetail);
  if (described && !meetingUrl) lines.push(described);

  if (service.locationKind === 'in_person' && service.locationDetail) {
    const map = mapUrlForInvite(service.locationDetail);
    if (map) lines.push(`Directions: ${map}`);
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * One email for a whole programme.
 *
 * The alternative — the confirmation sender called once per appointment —
 * would put ten near-identical emails in somebody's inbox within a second of
 * each other, which reads as a fault rather than a confirmation, and buries
 * whatever else was in there.
 *
 * So: one message, every appointment listed, and one calendar file holding
 * all of them (buildIcsCalendar) so the client taps once and the programme
 * is in their diary.
 *
 * Each appointment keeps its own line and its own link, because each really
 * is independent — that is the "stay flexible" half of what a pack promises,
 * and it falls out of these being ordinary bookings underneath.
 *
 * The outcome is recorded on every booking in the pack rather than the first
 * one, so the admin Bookings list tells the truth about all ten if the send
 * failed.
 */
export async function sendBookingPackConfirmedEmail(
  tenant: TenantRow,
  scope: TenantScope,
  bookings: BookingRow[],
): Promise<EmailStatus> {
  const [first] = bookings;
  if (!first) return 'not_configured';

  const packId = first.pack_id;
  const record = async (status: EmailStatus, error?: string) => {
    if (!packId) return;
    await scope
      .update('bookings', { email_status: status, email_error: error ?? null })
      .eq('pack_id', packId);
  };

  const [service, template, settings] = await Promise.all([
    loadServiceFacts(scope, first.event_type_id),
    loadTemplate(scope, 'booking_pack_confirmed'),
    loadTenantSettings(scope),
  ]);

  if (!template) {
    await record('not_configured');
    return 'not_configured';
  }

  const provider = emailProvider();
  if (provider.id === 'console') {
    await record('not_configured');
    return 'not_configured';
  }

  try {
    const rendered = renderTemplate(
      template,
      {
        clientName: first.name,
        serviceName: service.name,
        dateTime: formatDateTime(first.starts_at, tenant.timezone),
        packSize: String(first.pack_size ?? bookings.length),
        tenantName: tenant.name,
      },
      bookings.map((booking, index) => ({
        label: `${index + 1}. ${formatDateTime(booking.starts_at, tenant.timezone)} — change or cancel`,
        url: manageUrl(booking.manage_token),
      })),
    );

    await provider.send({
      to: { name: first.name, email: first.email },
      fromName: tenant.name,
      replyTo: settings?.reply_to_email ?? undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments: [
        {
          filename: 'appointments.ics',
          content: buildIcsCalendar(
            bookings.map((booking) => ({
              uid: booking.id,
              summary: `${service.name} — ${tenant.name}`,
              description: icsDescription(booking.meeting_url, service),
              location: booking.meeting_url ?? service.locationDetail ?? undefined,
              startsAt: booking.starts_at,
              endsAt: booking.ends_at,
              organizer: settings?.notification_email
                ? { name: tenant.name, email: settings.notification_email }
                : undefined,
              attendee: { name: first.name, email: first.email },
            })),
          ),
          contentType: 'text/calendar; method=PUBLISH',
        },
      ],
    });

    await record('sent');
    return 'sent';
  } catch (cause) {
    console.error('[booking-email] pack confirmation failed:', cause);
    await record('failed', (cause as Error).message);
    return 'failed';
  }
}
