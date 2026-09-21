import { emailProvider } from './email';
import { renderTemplate } from './email/templates';
import type { EmailStatus } from './db/types';

/**
 * The one email this product sends on its own behalf.
 *
 * Every other message here is a *tenant's* — their name in the From line,
 * their words in the body, their row in email_templates (see
 * src/lib/email/templates.ts). A password reset belongs to none of them: it
 * is intro writing to somebody about their intro account, and a business
 * must never be able to edit, disable or even see it. So the wording is
 * fixed here in code rather than seeded into a table, and it is deliberate
 * that this is the only file that does that.
 *
 * It still goes through renderTemplate, which gives it the same escaping
 * and the same appended-link treatment as everything else — the link is
 * never placed by hand in the body, for exactly the reason that module
 * describes: the one thing this email exists to carry cannot be the thing
 * that goes missing.
 */

/** How long Supabase's recovery links last, as the email should describe it. */
export const RECOVERY_LINK_HOURS = 1;

const TEMPLATE = {
  subject: 'Reset your intro password',
  body:
    'Somebody asked to reset the password for the intro account registered to this address.\n\n' +
    `Use the link below within ${RECOVERY_LINK_HOURS} hour to choose a new one. ` +
    'It can only be used once.\n\n' +
    'If this was not you, nothing has changed and you can ignore this email — ' +
    'your current password still works.',
} as const;

/**
 * Send it, and say what happened rather than throwing.
 *
 * The same posture as every other send in this codebase (booking-email.ts,
 * client-email.ts): the caller has already decided to answer the request
 * identically whatever the outcome, so a mail failure here must not become
 * an HTTP error that tells an anonymous caller their address was the one
 * worth failing on.
 */
export async function sendPasswordResetEmail(
  email: string,
  recoveryLink: string,
): Promise<Exclude<EmailStatus, 'pending'>> {
  const provider = emailProvider();
  if (provider.id === 'console') return 'not_configured';

  try {
    const rendered = renderTemplate(
      TEMPLATE,
      {},
      { label: 'Choose a new password', url: recoveryLink },
    );

    await provider.send({
      to: { email },
      fromName: 'intro',
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    return 'sent';
  } catch (cause) {
    console.error('[password-reset] could not send:', cause);
    return 'failed';
  }
}
