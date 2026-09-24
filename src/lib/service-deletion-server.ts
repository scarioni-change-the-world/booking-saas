import type { TenantScope } from './db';
import type { EventTypeRow } from './db/types';
import type { DeletionFacts } from './service-deletion';

/**
 * The database side of pausing, resuming and deleting a service. The rules
 * themselves are in service-deletion.ts, where the page can read them too.
 */

/** Deleted for good. Reads `deleted_at` loosely, so a database that has not
 *  run migration 0029 yet simply has no deleted services. */
export function isDeleted(row: Pick<EventTypeRow, 'deleted_at'>): boolean {
  return !!row.deleted_at;
}

/** One service that has not been deleted, or null. */
export async function loadLiveService(scope: TenantScope, id: string): Promise<EventTypeRow | null> {
  const { data, error } = await scope.select('event_types').eq('id', id).maybeSingle();
  if (error) throw error;
  const row = data as unknown as EventTypeRow | null;
  return row && !isDeleted(row) ? row : null;
}

/** Services taking appointments now, for the five-service allowance. */
export async function countActiveServices(scope: TenantScope, exceptId?: string): Promise<number> {
  const { data, error } = await scope.select('event_types').eq('active', true);
  if (error) throw error;
  const rows = (data ?? []) as unknown as EventTypeRow[];
  return rows.filter((r) => !isDeleted(r) && r.id !== exceptId).length;
}

/** What is still attached to a service: what is coming, what is owed, what is past. */
export async function loadDeletionFacts(scope: TenantScope, service: EventTypeRow): Promise<DeletionFacts> {
  const nowIso = new Date().toISOString();
  const [upcoming, past, owed] = await Promise.all([
    scope
      .select('bookings', 'starts_at')
      .eq('event_type_id', service.id)
      .eq('status', 'confirmed')
      .gte('starts_at', nowIso)
      .order('starts_at', { ascending: false }),
    scope.select('bookings', 'id').eq('event_type_id', service.id).eq('status', 'confirmed').lt('starts_at', nowIso),
    scope.select('client_entitlements', 'client_id, total_sessions, used_sessions').eq('event_type_id', service.id),
  ]);
  for (const result of [upcoming, past, owed]) if (result.error) throw result.error;

  const coming = (upcoming.data ?? []) as unknown as Array<{ starts_at: string }>;
  const balances = ((owed.data ?? []) as unknown as Array<{ client_id: string; total_sessions: number; used_sessions: number }>)
    .map((e) => ({ client: e.client_id, left: Math.max(0, e.total_sessions - e.used_sessions) }))
    .filter((e) => e.left > 0);

  return {
    name: service.name,
    active: service.active,
    upcoming: coming.length,
    lastUpcomingAt: coming[0]?.starts_at ?? null,
    owedSessions: balances.reduce((sum, e) => sum + e.left, 0),
    owedClients: new Set(balances.map((e) => e.client)).size,
    past: (past.data ?? []).length,
  };
}
