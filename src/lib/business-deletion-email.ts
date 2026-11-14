import { emailProvider } from './email';
import { renderTemplate } from './email/templates';
import { OPERATOR } from './operator';
import type { EmailStatus } from './db/types';

/**
 * The record that a business was deleted, sent to each of its owners after
 * it is gone. Like the service-deletion email, it is khloe writing about
 * the account: fixed wording, escaped like every other email.
 */
const TEMPLATE = {
  subject: '{{tenantName}} was deleted from khloe',
  body:
    '{{tenantName}} (/{{slug}}) was deleted from khloe on {{when}}.\n\n' +
    '{{cancelled}}' +
    'Its booking page, clients, appointments, services and settings are gone for good and cannot be restored. ' +
    '{{login}}\n\n' +
    'If you did not expect this, reply to this email straight away.',
} as const;

export async function sendBusinessDeletedEmail(input: {
  to: string;
  tenantName: string;
  slug: string;
  when: string;
  cancelled: number;
  loginDeleted: boolean;
}): Promise<Exclude<EmailStatus, 'pending'>> {
  const provider = emailProvider();
  if (provider.id === 'console') return 'not_configured';
  try {
    const rendered = renderTemplate(TEMPLATE, {
      tenantName: input.tenantName,
      slug: input.slug,
      when: input.when,
      cancelled:
        input.cancelled > 0
          ? `${input.cancelled === 1 ? '1 appointment still to come was' : `${input.cancelled} appointments still to come were`} cancelled first, and each client was emailed.\n\n`
          : '',
      login: input.loginDeleted
        ? 'Your khloe login was deleted with it, so this address can sign up again.'
        : 'Your khloe login stays, for your other business.',
    });
    await provider.send({
      to: { email: input.to },
      fromName: 'khloe',
      replyTo: OPERATOR.contactEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    return 'sent';
  } catch (cause) {
    console.error('[business-deletion] could not send:', cause);
    return 'failed';
  }
}
