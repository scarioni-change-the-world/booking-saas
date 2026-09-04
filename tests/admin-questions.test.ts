import { describe, expect, it } from 'vitest';
import { normaliseOptions, validateEventTypeId } from '@/lib/admin-questions';
import { BookingError } from '@/lib/booking-service';
import type { TenantScope } from '@/lib/db';

/** Records the query and lets a test say whether the row exists. Mirrors
 * tests/google.test.ts's fakeScope pattern. */
function fakeScope(row: { id: string } | null) {
  const filters: Array<[string, unknown]> = [];
  const scope = {
    select(_table: string, _columns?: string) {
      return {
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return this;
        },
        maybeSingle: async () => ({ data: row, error: null }),
      };
    },
  } as unknown as TenantScope;
  return { scope, filters };
}

describe('validateEventTypeId', () => {
  it('returns null when nothing was sent — "asked for every service"', async () => {
    const { scope } = fakeScope(null);
    expect(await validateEventTypeId(scope, undefined)).toBeNull();
  });

  it('returns the id once confirmed to belong to this tenant', async () => {
    const { scope, filters } = fakeScope({ id: 'evt-1' });
    expect(await validateEventTypeId(scope, 'evt-1')).toBe('evt-1');
    expect(filters).toContainEqual(['id', 'evt-1']);
  });

  it('throws a 404 for an id that does not belong to this tenant', async () => {
    const { scope } = fakeScope(null);
    try {
      await validateEventTypeId(scope, 'someone-elses-event-type');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BookingError);
      expect((error as BookingError).status).toBe(404);
    }
  });
});

// normaliseOptions already has thorough coverage of shape validation
// elsewhere in this suite's history; this just confirms scoping additions
// didn't disturb it.
describe('normaliseOptions (unaffected by scoping)', () => {
  it('still requires at least one option for single_choice', () => {
    expect(() => normaliseOptions('single_choice', { options: [] })).toThrow(BookingError);
  });
});
