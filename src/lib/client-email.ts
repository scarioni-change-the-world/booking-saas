import { emailProvider } from './email';
import { renderTemplate } from './email/templates';
import type { TenantScope } from './db';
import type { ClientRow, EmailStatus, TenantRow } from './db/types';

/**
 * Sending a client their own private booking link.
 *
 * The counterpart to booking-email.ts, and deliberately separate from it:
 * everything there is triggered by a booking's lifecycle and records its
 * outcome on the booking row. This one is about a *relationship* — it is
 * what turns "someone the tenant has decided they know" into someone
 * holding the link that lets them skip the questionnaire from now on
 * (migration 0010's clients.access_token, /t/[slug]/client/[token]).
 *
 * Before this existed, that link only ever reached a client if an admin
 * copied it out of the dashboard and pasted it into their own mail client.
 */

/** The link itself — the whole point of the email. */
export function clientBookingUrl(tenantSlug: string, accessToken: string): string {
  const base = process.env.PUBLIC_BASE_URL ?? '';
  return `${base}/t/${encodeURIComponent(tenantSlug)}/client/${encodeURIComponent(accessToken)}`;
}

/**
 * Send one client their link. Returns what actually happened rather than
 * throwing: a client record must exist whether or not the mail server
 * cooperated, exactly as a booking must (brief 6.9's lesson, applied in
 * booking-email.ts for the same reason). The caller surfaces this to the
 * admin, so "we saved them but couldn't email them" is something they can
 * see and act on instead of a silent half-success.
 *
 * 'not_configured' is a real, distinct outcome, not a polite failure: with
 * no SMTP configured the console provider accepts everything and returns a
 * fake id, so treating "didn't throw" as "sent" would tell an admin their
 * client has a link when nothing left the building.
 */
export async function sendClientInviteEmail(
  tenant: TenantRow,
  scope: TenantScope,
  client: ClientRow,
): Promise<Exclude<EmailStatus, 'pending'>> {
  try {
    const { data, error } = await scope
      .select('email_templates')
      .eq('kind', 'client_invite')
      .maybeSingle();
    if (error) throw error;

    const template = data as unknown as { subject: string; body: string } | null;
    if (!template) return 'not_configured';

    const rendered = renderTemplate(
      template,
      { clientName: client.name, tenantName: tenant.name },
      { label: 'Book a session', url: clientBookingUrl(tenant.slug, client.access_token) },
    );

    const provider = emailProvider();
    await provider.send({
      to: { name: client.name, email: client.email },
      fromName: tenant.name,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    return provider.id === 'console' ? 'not_configured' : 'sent';
  } catch (cause) {
    console.error('[client-email] invite send failed:', cause);
    return 'failed';
  }
}
