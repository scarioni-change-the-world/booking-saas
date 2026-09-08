import { DateTime } from 'luxon';
import { buildIcs } from './ics';
import { emailProvider } from './email';
import { renderTemplate, type TemplateTokens } from './email/templates';
import type { TenantScope } from './db';
import type {
  BookingRow,
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

async function loadEventTypeName(scope: TenantScope, eventTypeId: string): Promise<string> {
  // Not loadEventType (booking-service.ts) — that filters on active, and an
  // archived service's own past booking should still get a real name in its
  // emails, not a 404.
  const { data, error } = await scope.select('event_types', 'name').eq('id', eventTypeId).maybeSingle();
  if (error) throw error;
  return (data as { name: string } | null)?.name ?? 'your session';
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
  return `${process.env.PUBLIC_BASE_URL ?? ''}/manage/${manageToken}`;
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
): Promise<void> {
  const [serviceName, template, settings] = await Promise.all([
    loadEventTypeName(scope, booking.event_type_id),
    loadTemplate(scope, kind),
    loadTenantSettings(scope),
  ]);

  if (!template) {
    await recordEmailStatus(scope, booking.id, 'not_configured');
    return;
  }

  const dateTime = formatDateTime(booking.starts_at, tenant.timezone);
  const tokens: TemplateTokens = {
    clientName: booking.name,
    serviceName,
    dateTime,
    meetingLink: booking.meeting_url ?? '',
    tenantName: tenant.name,
  };

  try {
    const rendered = renderTemplate(
      template,
      tokens,
      options.includeManageLink
        ? { label: 'Change or cancel your booking', url: manageUrl(booking.manage_token) }
        : undefined,
    );

    const attachments = options.includeIcs
      ? [
          {
            filename: 'invite.ics',
            content: buildIcs({
              uid: booking.id,
              summary: `${serviceName} — ${tenant.name}`,
              description: booking.meeting_url ? `Meeting link: ${booking.meeting_url}` : undefined,
              location: booking.meeting_url ?? undefined,
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

    await emailProvider().send({
      to: { name: booking.name, email: booking.email },
      fromName: tenant.name,
      replyTo: settings?.reply_to_email ?? undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments,
    });
    await recordEmailStatus(scope, booking.id, 'sent');
  } catch (cause) {
    console.error(`[booking-email] ${kind} send failed:`, cause);
    await recordEmailStatus(scope, booking.id, 'failed', (cause as Error).message);
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
): Promise<void> {
  await sendClientEmail(tenant, scope, booking, 'booking_confirmed', {
    includeIcs: true,
    includeManageLink: true,
  });

  const settings = await loadTenantSettings(scope);
  if (settings?.notification_email) {
    const serviceName = await loadEventTypeName(scope, booking.event_type_id);
    const dateTime = formatDateTime(booking.starts_at, tenant.timezone);
    await sendOwnerNotification(tenant, scope, booking, serviceName, dateTime, settings.notification_email);
  }
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
