import { emailProvider } from './email';
import { renderTemplate, type TemplateLink } from './email/templates';
import type { EmailStatus } from './db/types';
import { OPERATOR } from './operator';

/**
 * The emails signing up sends — khloe writing on its own behalf, like the
 * password reset (see password-reset-email.ts, whose posture this follows:
 * fixed wording in code, and a send that reports rather than throws).
 */

type SendStatus = Exclude<EmailStatus, 'pending'>;

async function send(
  to: string,
  template: { subject: string; body: string },
  tokens: Record<string, string>,
  link?: TemplateLink,
): Promise<SendStatus> {
  const provider = emailProvider();
  if (provider.id === 'console') return 'not_configured';
  try {
    const rendered = renderTemplate(template, tokens, link);
    await provider.send({
      to: { email: to },
      fromName: 'khloe',
      // A real address that a person answers. A message whose replies go
      // nowhere is one more thing that looks like bulk mail to a filter.
      replyTo: OPERATOR.contactEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    return 'sent';
  } catch (cause) {
    console.error('[signup] could not send:', cause);
    return 'failed';
  }
}

/** The link that confirms the address and opens the new business. */
export function sendSignupConfirmEmail(
  email: string,
  businessName: string,
  link: string,
): Promise<SendStatus> {
  return send(
    email,
    {
      subject: 'Confirm your email to open {{business}} on khloe',
      body:
        'Welcome to khloe.\n\n' +
        'Open the link below to confirm this is your address. Your account for {{business}} is ready the moment you ' +
        'do, with 30 days free and nothing to pay until you decide to stay.\n\n' +
        'The link works once, for an hour — sign up again for a fresh one. If you did not sign up, ignore this email and nothing is created.',
    },
    { business: businessName },
    { label: 'Confirm and open khloe', url: link },
  );
}

/**
 * Somebody tried to sign up with an address that already has an account.
 * The form answered exactly as for a new address — it must not say which
 * addresses are customers — and says this email explains instead.
 *
 * Written to read as what it is, not like the phishing it resembles: it
 * names the business the account opens (only the owner of this inbox sees
 * it), says plainly that nothing changed, gives the password reset as its
 * own link, and asks for nothing.
 */
export function sendAlreadyRegisteredEmail(
  email: string,
  links: { signInUrl: string; resetUrl: string; businesses: string[] },
): Promise<SendStatus> {
  const which = links.businesses.length
    ? ` It opens ${links.businesses.length === 1 ? links.businesses[0] : links.businesses.join(', ')}.`
    : '';
  return send(
    email,
    {
      subject: 'Your khloe account already exists',
      body:
        `You asked to create a khloe account with this address, but it already has one.{{which}} ` +
        'Nothing new was created and nothing was changed.\n\n' +
        'Sign in with your usual password using the button below. Forgotten it? Set a new one here: {{reset}}\n\n' +
        'If you did not ask for this, ignore this email: your account is unaffected. Questions? Reply to this ' +
        'email.',
    },
    { which, reset: links.resetUrl },
    { label: 'Sign in to khloe', url: links.signInUrl },
  );
}

/**
 * Tell whoever runs khloe that a business joined (SIGNUP_ALERT_EMAIL).
 * Optional: unset, nothing is sent.
 */
export async function sendNewSignupAlert(
  business: { name: string; slug: string },
  owner: string,
): Promise<void> {
  const to = process.env.SIGNUP_ALERT_EMAIL;
  if (!to) return;
  await send(
    to,
    {
      subject: 'New business on khloe: {{business}}',
      body: '{{business}} (/{{slug}}) just signed up, as {{owner}}. It is on a 30-day trial.',
    },
    { business: business.name, slug: business.slug, owner },
  );
}
