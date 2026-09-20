import { describe, expect, it } from 'vitest';
import type { TenantScope } from '@/lib/db';
import { serviceAsksProspectAnything } from '@/lib/qualification-response-service';

/**
 * The gate on the public calendar and on booking creation.
 *
 * Both refuse a prospect without a completed questionnaire on the meeting
 * path. That is correct when there are questions and was catastrophic when
 * there were none: the widget sends a visitor straight to the calendar for a
 * service that asks nothing, and the calendar then refused to load because
 * they had not completed questions that did not exist. "Complete the
 * questions first", over an empty calendar, with no questions anywhere.
 *
 * Which meant a business with no screening could take no bookings — the
 * state every business is in on its first day, before anyone has written a
 * question. These tests exist so that cannot come back.
 */

/** A scope that answers with the rows each (table, filter) combination holds. */
function fakeScope(rows: { shared: number; specific: Record<string, number> }): TenantScope {
  return {
    select(table: string) {
      let scopedTo: { column: string; value: string | null } | null = null;
      const chain = {
        eq(column: string, value: string) {
          scopedTo = { column, value };
          return chain;
        },
        is(column: string, value: null) {
          scopedTo = { column, value };
          return chain;
        },
        limit() {
          if (table !== 'qualification_questions') return { data: [], error: null };
          const count =
            scopedTo?.value === null ? rows.shared : (rows.specific[scopedTo!.value as string] ?? 0);
          return { data: Array.from({ length: Math.min(count, 1) }, () => ({ id: 'x' })), error: null };
        },
      };
      return chain;
    },
  } as unknown as TenantScope;
}

describe('serviceAsksProspectAnything', () => {
  it('is true when the tenant has shared questions', async () => {
    const scope = fakeScope({ shared: 2, specific: {} });
    await expect(serviceAsksProspectAnything(scope, 'svc-1')).resolves.toBe(true);
  });

  it('is true when only this service has its own questions', async () => {
    const scope = fakeScope({ shared: 0, specific: { 'svc-1': 1 } });
    await expect(serviceAsksProspectAnything(scope, 'svc-1')).resolves.toBe(true);
  });

  /* The one that matters: nothing to ask means nothing to withhold. A false
     here is what lets a brand-new business take its first booking. */
  it('is false when neither the tenant nor the service asks anything', async () => {
    const scope = fakeScope({ shared: 0, specific: {} });
    await expect(serviceAsksProspectAnything(scope, 'svc-1')).resolves.toBe(false);
  });

  /* Another service's questions must not gate this one — a business can
     screen for its €2,000 programme and not for its free intro call. */
  it('ignores questions belonging to a different service', async () => {
    const scope = fakeScope({ shared: 0, specific: { 'svc-other': 3 } });
    await expect(serviceAsksProspectAnything(scope, 'svc-1')).resolves.toBe(false);
  });

  it('falls back to the shared questions when no service is named', async () => {
    await expect(serviceAsksProspectAnything(fakeScope({ shared: 1, specific: {} }), null)).resolves.toBe(
      true,
    );
    await expect(serviceAsksProspectAnything(fakeScope({ shared: 0, specific: {} }), null)).resolves.toBe(
      false,
    );
  });
});
