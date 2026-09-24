import { serializeClient } from './admin-serializers';
import type { TenantScope } from './db';
import type { ClientRow } from './db/types';

interface EntitlementJoin {
  id: string;
  event_type_id: string;
  total_sessions: number;
  used_sessions: number;
  event_types: { name: string } | null;
}

/**
 * Every client, with their session balances alongside them — the whole
 * point of reading clients is "who has sessions left", not just "who
 * exists". Shared by the clients endpoint and People, so the two can never
 * disagree about what somebody is owed.
 */
export async function loadClients(scope: TenantScope) {
  const { data, error } = await scope
    .select(
      'clients',
      '*, client_entitlements(id, event_type_id, total_sessions, used_sessions, event_types(name))',
    )
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<ClientRow & { client_entitlements: EntitlementJoin[] }>;

  return rows.map((row) => ({
    ...serializeClient(row),
    entitlements: row.client_entitlements.map((e) => ({
      id: e.id,
      eventTypeId: e.event_type_id,
      eventTypeName: e.event_types?.name ?? 'Unknown session type',
      totalSessions: e.total_sessions,
      usedSessions: e.used_sessions,
      remaining: e.total_sessions - e.used_sessions,
    })),
  }));
}
