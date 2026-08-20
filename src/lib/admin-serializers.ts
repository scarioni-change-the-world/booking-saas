import type { EventTypeRow } from './db/types';

/**
 * Database rows use snake_case column names; the public booking API already
 * hands the browser camelCase (see components/types.ts). The admin API
 * follows the same convention rather than leaking raw column names into a
 * second, inconsistent shape.
 */
export function serializeEventType(row: EventTypeRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    color: row.color,
    sortOrder: row.sort_order,
    availableToProspects: row.available_to_prospects,
    availableToExistingClients: row.available_to_existing_clients,
    active: row.active,
    createdAt: row.created_at,
  };
}

export type SerializedEventType = ReturnType<typeof serializeEventType>;
