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

  const port = Number(process.env.SMTP_PORT ?? '587');
  return new SmtpEmailProvider({
    host,
    port,
    secure: port === 465,
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    fromAddress: process.env.EMAIL_FROM_ADDRESS ?? 'no-reply@example.com',
  });
}
