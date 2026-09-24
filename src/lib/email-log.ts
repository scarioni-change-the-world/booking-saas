import type { TenantScope } from './db';
import type { EmailStatus, EmailTemplateKind } from './db/types';

/**
 * Write down that an email went out, or tried to (migration 0027).
 *
 * Best effort and silent on failure, like the sends themselves: a booking
 * must never fail because the note about its confirmation could not be
 * filed. What it costs when it does fail is one missing tally on Messages,
 * which is the right way round.
 */
export async function logEmailSend(
  scope: TenantScope,
  entry: {
    kind: EmailTemplateKind;
    status: Exclude<EmailStatus, 'pending'>;
    bookingId?: string | null;
    clientId?: string | null;
    error?: string | null;
  },
): Promise<void> {
  try {
    const { error } = await scope.insert('email_sends', {
      kind: entry.kind,
      status: entry.status,
      booking_id: entry.bookingId ?? null,
      client_id: entry.clientId ?? null,
      error: entry.error ? entry.error.slice(0, 500) : null,
    });
    if (error) throw error;
  } catch (cause) {
    console.error('[email-log] could not record a send:', cause);
  }
}
