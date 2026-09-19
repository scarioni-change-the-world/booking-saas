import { ConsoleEmailProvider } from './console';
import { SmtpEmailProvider } from './smtp';
import type { EmailProvider } from './provider';

export * from './provider';
export { ConsoleEmailProvider } from './console';
export { SmtpEmailProvider } from './smtp';

/**
 * Resolve the email provider from SMTP_* env vars — whatever mailbox a
 * host hands you (Hostinger or otherwise; see .env.example), not a
 * provider-specific API. Falls back to ConsoleEmailProvider rather than
 * throwing when unconfigured: unlike Calendar and AI, nothing here gates a
 * user-facing action on the result — a booking must still succeed with no
 * email sent, loudly logged, rather than fail outright (see
 * src/lib/booking-email.ts). The SPF/DKIM setup on whatever domain
 * EMAIL_FROM_ADDRESS uses is the step consistently skipped and then
 * responsible for "our emails go to spam" tickets — worth doing once,
 * outside this code.
 */
export function emailProvider(): EmailProvider {
  const host = process.env.SMTP_HOST;
  if (!host) return new ConsoleEmailProvider();

  // Setting SMTP_HOST switches this from logging to really sending, so the
  // other three stop being optional at that moment. A missing one used to be
  // papered over: EMAIL_FROM_ADDRESS fell back to no-reply@example.com, a
  // domain nobody deploying this owns, which a receiving server either
  // rejects for failing SPF or — worse — delivers, as a confirmation the
  // client cannot reply to and the operator never sees bounce.
  //
  // Refusing to send is the better failure. It is loud in the log, it is
  // visible on /api/health, and it keeps the existing promise that email is
  // never what breaks a booking: the console provider still prints the
  // message that would have gone out.
  const fromAddress = process.env.EMAIL_FROM_ADDRESS?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;

  if (!fromAddress || !user || !password) {
    const missing = [
      !fromAddress && 'EMAIL_FROM_ADDRESS',
      !user && 'SMTP_USER',
      !password && 'SMTP_PASSWORD',
    ].filter(Boolean);
    console.error(
      `[email] SMTP_HOST is set but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not — ` +
        'logging mail instead of sending it. See /api/health.',
    );
    return new ConsoleEmailProvider();
  }

  const port = Number(process.env.SMTP_PORT ?? '587');
  return new SmtpEmailProvider({
    host,
    port,
    secure: port === 465,
    user,
    password,
    fromAddress,
  });
}
