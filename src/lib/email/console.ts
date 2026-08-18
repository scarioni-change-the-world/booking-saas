import type { EmailProvider, OutboundEmail } from './provider';

/**
 * Development provider: logs instead of sending.
 *
 * Loud rather than silent, because brief 6.8's lesson is that a quiet degraded
 * path is the dangerous kind. Selected only when no real provider is
 * configured, and it says so on every send.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly id = 'console';

  async send(email: OutboundEmail): Promise<{ id: string }> {
    const id = `console-${Date.now()}`;
    console.warn(
      `[email:console] NOT SENT — no email provider configured. ` +
        `to=${email.to.email} subject=${JSON.stringify(email.subject)} id=${id}`,
    );
    return { id };
  }
}
