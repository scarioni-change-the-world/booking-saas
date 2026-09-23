import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Saving a painted week replaces whole weekdays, and the order of the two
 * writes is the thing worth pinning: there is no transaction across them,
 * so new hours must land before old hours are removed. The other order
 * would leave a business with no hours on that day if the second write
 * failed — and nobody finds that out until a client says the page is empty.
 */

const calls: string[] = [];
let existingIds: string[] = [];
let insertedRows: unknown[] = [];
let deletedIds: string[] = [];
let selectedWeekdays: number[] = [];
let failDelete = false;

function query(result: unknown) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  q.order = self;
  q.eq = self;
  q.in = (_col: string, values: number[]) => {
    selectedWeekdays = values;
    return Promise.resolve(result);
  };
  q.then = (resolve: (v: unknown) => void) => resolve(result);
  return q;
}

const scope = {
  select: vi.fn((_table: string, columns?: string) => {
    if (columns === 'id') {
      calls.push('select-old');
      return query({ data: existingIds.map((id) => ({ id })), error: null });
    }
    calls.push('select-all');
    return query({ data: [], error: null });
  }),
  insert: vi.fn(async (_table: string, rows: unknown[]) => {
    calls.push('insert');
    insertedRows = rows;
    return { data: rows, error: null };
  }),
  delete: vi.fn(() => ({
    in: async (_col: string, ids: string[]) => {
      calls.push('delete');
      deletedIds = ids;
      return failDelete ? { error: new Error('connection lost') } : { error: null };
    },
  })),
};

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  requireTenantAdmin: vi.fn(async () => ({ scope, tenant: { id: 't1', timezone: 'Europe/Madrid' } })),
}));

const { PUT } = await import('@/app/api/admin/[slug]/availability-rules/route');

function put(body: unknown) {
  return PUT(
    new Request('http://x/api/admin/test/availability-rules', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: 'test' }) },
  );
}

beforeEach(() => {
  calls.length = 0;
  existingIds = ['old-tue-1', 'old-tue-2'];
  insertedRows = [];
  deletedIds = [];
  selectedWeekdays = [];
  failDelete = false;
});

describe('replacing weekdays', () => {
  it('puts the new hours in before taking the old ones out', async () => {
    const res = await put({
      days: [{ weekday: 2, windows: [{ startTime: '09:00', endTime: '13:00' }] }],
    });
    expect(res.status).toBe(200);
    expect(calls.indexOf('insert')).toBeLessThan(calls.indexOf('delete'));
    expect(insertedRows).toEqual([{ weekday: 2, start_time: '09:00', end_time: '13:00' }]);
    expect(deletedIds).toEqual(['old-tue-1', 'old-tue-2']);
  });

  it('only looks for old hours on the weekdays being replaced', async () => {
    await put({ days: [{ weekday: 2, windows: [] }, { weekday: 4, windows: [] }] });
    expect(selectedWeekdays).toEqual([2, 4]);
  });

  it('closes a weekday when given no windows, without inserting anything', async () => {
    await put({ days: [{ weekday: 2, windows: [] }] });
    expect(calls).not.toContain('insert');
    expect(deletedIds).toEqual(['old-tue-1', 'old-tue-2']);
  });

  it('reports a failed removal instead of pretending it saved', async () => {
    failDelete = true;
    const res = await put({
      days: [{ weekday: 2, windows: [{ startTime: '09:00', endTime: '13:00' }] }],
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    // The new hours are already in: the day has too many hours, not none.
    expect(calls).toContain('insert');
  });

  it('refuses a window that ends before it starts, before writing anything', async () => {
    const res = await put({
      days: [{ weekday: 2, windows: [{ startTime: '13:00', endTime: '09:00' }] }],
    });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refuses the same weekday twice', async () => {
    const res = await put({ days: [{ weekday: 2, windows: [] }, { weekday: 2, windows: [] }] });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refuses a weekday that does not exist', async () => {
    const res = await put({ days: [{ weekday: 8, windows: [] }] });
    expect(res.status).toBe(400);
  });
});
