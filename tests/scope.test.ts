import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tenantScope } from '@/lib/db/scope';

/**
 * Cross-tenant isolation on the service-role path (brief 7.1).
 *
 * A recording stand-in for the Supabase builder. Each call appends to a log, so
 * a test can assert on the query that *would* have been sent without needing a
 * database. The point is not to test Supabase — it is to prove that a caller
 * cannot construct an unscoped query through TenantScope.
 */
interface Call {
  table: string;
  op: string;
  filters: Array<[string, unknown]>;
  payload?: unknown;
}

function recorder() {
  const calls: Call[] = [];

  const builder = (call: Call) => {
    const chain = {
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return chain;
      },
      select() {
        return chain;
      },
    };
    return chain;
  };

  const client = {
    from(table: string) {
      return {
        select(_columns?: string) {
          const call: Call = { table, op: 'select', filters: [] };
          calls.push(call);
          return builder(call);
        },
        insert(payload: unknown) {
          const call: Call = { table, op: 'insert', filters: [], payload };
          calls.push(call);
          return builder(call);
        },
        update(payload: unknown) {
          const call: Call = { table, op: 'update', filters: [], payload };
          calls.push(call);
          return builder(call);
        },
        delete() {
          const call: Call = { table, op: 'delete', filters: [] };
          calls.push(call);
          return builder(call);
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

describe('TenantScope', () => {
  it('filters every read to the scoped tenant', () => {
    const { client, calls } = recorder();
    tenantScope(TENANT_A, client).select('bookings');

    expect(calls[0]!.filters).toContainEqual(['tenant_id', TENANT_A]);
  });

  it('scopes reads on every tenant-scoped table', () => {
    const tables = [
      'tenant_settings',
      'event_types',
      'availability_rules',
      'date_overrides',
      'blocked_slots',
      'qualification_questions',
      'qualification_responses',
      'bookings',
    ] as const;

    const { client, calls } = recorder();
    const scope = tenantScope(TENANT_A, client);
    for (const table of tables) scope.select(table);

    expect(calls).toHaveLength(tables.length);
    for (const call of calls) {
      expect(call.filters).toContainEqual(['tenant_id', TENANT_A]);
    }
  });

  it('stamps the scoped tenant on every inserted row', () => {
    const { client, calls } = recorder();
    tenantScope(TENANT_A, client).insert('bookings', [
      { name: 'One', email: 'one@example.com' },
      { name: 'Two', email: 'two@example.com' },
    ]);

    expect(calls[0]!.payload).toEqual([
      { name: 'One', email: 'one@example.com', tenant_id: TENANT_A },
      { name: 'Two', email: 'two@example.com', tenant_id: TENANT_A },
    ]);
  });

  it('overwrites a tenant_id smuggled into an insert', () => {
    // The shape a hostile request body would take if it reached the data layer.
    const { client, calls } = recorder();
    tenantScope(TENANT_A, client).insert('bookings', {
      name: 'Mallory',
      tenant_id: TENANT_B,
    } as never);

    expect(calls[0]!.payload).toEqual([{ name: 'Mallory', tenant_id: TENANT_A }]);
  });

  it('refuses to move a row to another tenant via update', () => {
    const { client, calls } = recorder();
    tenantScope(TENANT_A, client).update('bookings', {
      notes: 'moved',
      tenant_id: TENANT_B,
    } as never);

    expect(calls[0]!.payload).toEqual({ notes: 'moved' });
    expect(calls[0]!.payload).not.toHaveProperty('tenant_id');
    expect(calls[0]!.filters).toContainEqual(['tenant_id', TENANT_A]);
  });

  it('confines a delete to the scoped tenant', () => {
    const { client, calls } = recorder();
    tenantScope(TENANT_A, client).delete('blocked_slots');

    expect(calls[0]!.op).toBe('delete');
    expect(calls[0]!.filters).toContainEqual(['tenant_id', TENANT_A]);
  });

  it('keeps two scopes independent', () => {
    const { client, calls } = recorder();
    tenantScope(TENANT_A, client).select('bookings');
    tenantScope(TENANT_B, client).select('bookings');

    expect(calls[0]!.filters).toContainEqual(['tenant_id', TENANT_A]);
    expect(calls[1]!.filters).toContainEqual(['tenant_id', TENANT_B]);
  });

  it('rejects an empty tenant id rather than building an unfiltered query', () => {
    const { client } = recorder();
    expect(() => tenantScope('', client)).toThrow();
  });
});
