import { decryptSecret } from '../crypto';
import type { TenantScope } from '../db';
import type { CalendarConnectionRow, CalendarProviderId } from '../db/types';

/**
 * Saving and removing a business's calendar connection.
 *
 * One calendar at a time: a business connects Google or Outlook, not both.
 * Busy times come from one place and each booking gets one event, so a
 * second connection would only raise the question "which one?" for every
 * booking. Connecting one replaces the other, and the replaced grant is
 * given up properly (revoked where the provider allows it).
 */

/** Ask the provider to forget a grant. Best effort: deleting ours must not wait on it. */
export async function revokeGrant(connection: CalendarConnectionRow): Promise<void> {
  if (connection.provider !== 'google') {
    // Microsoft offers apps no call to revoke a single refresh token; the
    // person can remove khloe from their Microsoft account's app permissions.
    return;
  }
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: decryptSecret(connection.refresh_token_encrypted) }),
    });
  } catch (cause) {
    console.warn('[calendar] revoke failed, deleting the local grant anyway:', cause);
  }
}

/** Store a new grant for `provider`, replacing whatever calendar was connected before. */
export async function saveConnection(
  scope: TenantScope,
  provider: CalendarProviderId,
  row: Partial<CalendarConnectionRow>,
): Promise<void> {
  const { data, error } = await scope.select('calendar_connections');
  if (error) throw error;
  const existing = (data ?? []) as unknown as CalendarConnectionRow[];

  for (const other of existing.filter((c) => c.provider !== provider)) {
    await revokeGrant(other);
    const removed = await scope.delete('calendar_connections').eq('id', other.id);
    if (removed.error) throw removed.error;
  }

  const same = existing.find((c) => c.provider === provider);
  const saved = same
    ? await scope.update('calendar_connections', { ...row, provider }).eq('id', same.id)
    : await scope.insert('calendar_connections', { ...row, provider });
  if (saved.error) throw saved.error;
}
