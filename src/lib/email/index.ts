import { ConsoleEmailProvider } from './console';
import type { EmailProvider } from './provider';

export * from './provider';
export { ConsoleEmailProvider } from './console';

/**
 * Resolve the email provider.
 *
 * Resend or Postmark goes here (brief 7.5). Whichever is chosen, the SPF/DKIM
 * setup is the step the brief singles out as consistently skipped and then
 * responsible for "our emails go to spam" tickets.
 */
export function emailProvider(): EmailProvider {
  return new ConsoleEmailProvider();
}
