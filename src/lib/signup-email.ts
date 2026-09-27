import { emailProvider } from './email';
import { renderTemplate, type TemplateLink } from './email/templates';
import type { EmailStatus } from './db/types';

/**
 * The emails signing up sends — intro writing on its own behalf, like the
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
      fromName: 'intro',
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
      subject: 'Confirm your email to open {business} on intro',
      body:
        'Welcome to intro.\n\n' +
        'Open the link below to confirm this is your address. Your account for {business} is ready the moment you ' +
        'do, with 7 days free and nothing to pay until you decide to stay.\n\n' +
        'The link works once, for 24 hours. If you did not sign up, ignore this email and nothing is created.',
    },
    { business: businessName },
    { label: 'Confirm and open intro', url: link },
  );
}

/**
 * Somebody tried to sign up with an address that already has an account.
 * The form answered exactly as for a new address — it must not say which
 * addresses are customers — so the owner of the address hears it here.
 */
export function sendAlreadyRegisteredEmail(email: string, signInUrl: string): Promise<SendStatus> {
  return send(
    email,
    {
      subject: 'You already have an intro account',
      body:
        'Somebody — probably you — tried to sign up to intro with this address. It already has an account, so ' +
        'nothing new was created.\n\n' +
        'Sign in with the link below. If you have forgotten your password, the sign-in page can send you a new one. ' +
        'If this was not you, you can ignore this email.',
    },
    {},
    { label: 'Sign in to intro', url: signInUrl },
  );
}

/**
 * Tell whoever runs intro that a business joined (SIGNUP_ALERT_EMAIL).
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
      subject: 'New business on intro: {business}',
      body: '{business} (/t/{slug}) just signed up, as {owner}. It is on a 7-day trial.',
    },
    { business: business.name, slug: business.slug, owner },
  );
}
