import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateTenant = vi.fn();
vi.mock('@/lib/db/console', () => ({
  updateTenant: (...args: unknown[]) => updateTenant(...args),
  listTenantMembers: async () => [],
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  requireTenantAdmin: async () => ({ tenant: { id: 't1', slug: 'ruiz', name: 'Ruiz', timezone: 'Europe/Madrid' }, userId: 'u', role: 'owner', scope: {} }),
}));

const { PATCH } = await import('@/app/api/admin/[slug]/account/route');

const patch = (body: unknown) =>
  PATCH(
    new Request('http://x/api/admin/ruiz/account', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: 'ruiz' }) },
  );

beforeEach(() => {
  updateTenant.mockReset();
  updateTenant.mockImplementation(async (_id: string, p: Record<string, string>) => ({
    name: p.name ?? 'Ruiz',
    slug: 'ruiz',
    timezone: p.timezone ?? 'Europe/Madrid',
    created_at: '2026-01-01T00:00:00Z',
  }));
});

describe('changing the account', () => {
  it('renames the business, trimmed, and changes only what was sent', async () => {
    const res = await patch({ name: '  Ruiz Studio  ' });
    expect(res.status).toBe(200);
    expect(updateTenant).toHaveBeenCalledWith('t1', { name: 'Ruiz Studio' });
  });

  it('moves the business to a real time zone', async () => {
    await patch({ timezone: 'Europe/London' });
    expect(updateTenant).toHaveBeenCalledWith('t1', { timezone: 'Europe/London' });
  });

  it('refuses a zone that does not exist, and changes nothing', async () => {
    const res = await patch({ timezone: 'Mars/Olympus' });
    expect(res.status).toBe(400);
    expect(updateTenant).not.toHaveBeenCalled();
  });

  it('refuses a blank name', async () => {
    const res = await patch({ name: '   ' });
    expect(res.status).toBe(400);
    expect(updateTenant).not.toHaveBeenCalled();
  });

  it('refuses a request that changes nothing', async () => {
    expect((await patch({ plan: 'pro' })).status).toBe(400);
    expect(updateTenant).not.toHaveBeenCalled();
  });
});
