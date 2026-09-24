import { emailProvider } from './email';
import { renderTemplate } from './email/templates';
import type { EmailStatus } from './db/types';

/**
 * The record that a service was deleted, sent to whoever deleted it.
 *
 * Like the password reset (password-reset-email.ts), this is intro writing
 * about the account, not the business writing to a client: fixed wording,
 * never a row in email_templates a business could edit or turn off. It goes
 * through renderTemplate for the same escaping every other email gets.
 */
const TEMPLATE = {
  subject: '{{serviceName}} was deleted from {{tenantName}}',
  body:
    '{{serviceName}} was deleted from {{tenantName}} on {{when}}, by {{who}}.\n\n' +
    'It is off your booking page and out of your services for good, and it cannot be restored.\n\n' +
    '{{kept}}\n\n' +
    'Nobody was cancelled or emailed: it had nothing still coming up and nothing still owed.\n\n' +
    'If you did not do this, reply to this email or tell support straight away.',
} as const;

export async function sendServiceDeletedEmail(input: {
  to: string;
  serviceName: string;
  tenantName: string;
  when: string;
  kept: string;
}): Promise<Exclude<EmailStatus, 'pending'>> {
  const provider = emailProvider();
  if (provider.id === 'console') return 'not_configured';

  try {
    const rendered = renderTemplate(TEMPLATE, {
      serviceName: input.serviceName,
      tenantName: input.tenantName,
      when: input.when,
      who: input.to,
      kept: input.kept,
    });
    await provider.send({
      to: { email: input.to },
      fromName: 'intro',
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    return 'sent';
  } catch (cause) {
    console.error('[service-deletion] could not send:', cause);
    return 'failed';
  }
}
