import { describe, expect, it } from 'vitest';
import { startResponse } from '@/lib/qualification-response-service';
import type { TenantScope } from '@/lib/db';

/** Records what was inserted. Mirrors tests/google.test.ts's fakeScope pattern. */
function fakeScope() {
  const inserted: Array<Record<string, unknown>> = [];
  const scope = {
    insert(_table: string, values: Record<string, unknown>) {
      inserted.push(values);
      return Promise.resolve({ data: [{ id: 'resp-1', ...values }], error: null });
    },
  } as unknown as TenantScope;
  return { scope, inserted };
}

describe('startResponse', () => {
  it('stamps the response with the service it was started for', async () => {
    const { scope, inserted } = fakeScope();
    const id = await startResponse(scope, 'prospect@example.com', 'evt-1');

    expect(id).toBe('resp-1');
    expect(inserted).toEqual([
      {
        email: 'prospect@example.com',
        answers: [],
        outcome_path_type: null,
        completed_at: null,
        event_type_id: 'evt-1',
      },
    ]);
  });
});
