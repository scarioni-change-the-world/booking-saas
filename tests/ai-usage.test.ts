import { describe, expect, it } from 'vitest';
import { assertUnderMonthlyLimit, recordUsage } from '@/lib/ai/usage';
import { AiUnavailableError } from '@/lib/ai/provider';
import type { TenantScope } from '@/lib/db';

/** Records what was inserted and lets a test set how many rows the "this
 * month" count query should answer with. Mirrors tests/google.test.ts's
 * fakeScope pattern: a plain object cast to TenantScope, not a real
 * Supabase client. */
function fakeScope(existingCount: number, opts: { selectError?: Error; insertError?: Error } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const filters: Array<[string, unknown]> = [];

  const scope = {
    select(_table: string, _columns?: string) {
      const rows = opts.selectError ? null : Array.from({ length: existingCount }, (_, i) => ({ id: `evt-${i}` }));
      const chain = {
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return chain;
        },
        gte(column: string, value: unknown) {
          filters.push([column, value]);
          return chain;
        },
        then(resolve: (result: { data: unknown; error: unknown }) => unknown) {
          return resolve({ data: rows, error: opts.selectError ?? null });
        },
      };
      return chain;
    },
    insert(_table: string, values: Record<string, unknown>) {
      inserted.push(values);
      return Promise.resolve({ data: null, error: opts.insertError ?? null });
    },
  } as unknown as TenantScope;

  return { scope, inserted, filters };
}

describe('assertUnderMonthlyLimit', () => {
  it('allows a tenant with no usage this month through', async () => {
    const { scope } = fakeScope(0);
    await expect(assertUnderMonthlyLimit(scope, 'intake_draft')).resolves.toBeUndefined();
  });

  it('allows a tenant under the limit through', async () => {
    const { scope, filters } = fakeScope(19);
    await expect(assertUnderMonthlyLimit(scope, 'intake_draft')).resolves.toBeUndefined();
    expect(filters).toContainEqual(['kind', 'intake_draft']);
  });

  it('throws AiUnavailableError(429) once the tenant has hit the limit', async () => {
    const { scope } = fakeScope(20);
    try {
      await assertUnderMonthlyLimit(scope, 'intake_draft');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AiUnavailableError);
      expect((error as AiUnavailableError).status).toBe(429);
      expect((error as Error).message).toContain('20');
    }
  });

  it('throws for a tenant already over the limit, not just at it', async () => {
    const { scope } = fakeScope(25);
    await expect(assertUnderMonthlyLimit(scope, 'intake_draft')).rejects.toThrow(AiUnavailableError);
  });

  it('propagates a database error from the count query as-is', async () => {
    const { scope } = fakeScope(0, { selectError: new Error('connection reset') });
    await expect(assertUnderMonthlyLimit(scope, 'intake_draft')).rejects.toThrow('connection reset');
  });
});

describe('recordUsage', () => {
  it('inserts one ai_usage_events row for the given kind', async () => {
    const { scope, inserted } = fakeScope(0);
    await recordUsage(scope, 'intake_draft');
    expect(inserted).toEqual([{ kind: 'intake_draft' }]);
  });

  it('propagates a database error from the insert as-is', async () => {
    const { scope } = fakeScope(0, { insertError: new Error('unique violation') });
    await expect(recordUsage(scope, 'intake_draft')).rejects.toThrow('unique violation');
  });
});
