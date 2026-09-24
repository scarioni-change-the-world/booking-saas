import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventTypeOfTestResponse, partForPhase, testResponseId, TEST_HEADER } from '@/lib/test-run';

const requireTenantAdmin = vi.fn();
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  requireTenantAdmin: (...args: unknown[]) => requireTenantAdmin(...args),
}));

const createBooking = vi.fn();
const createBookingPack = vi.fn();
vi.mock('@/lib/booking-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/booking-service')>()),
  createBooking: (...args: unknown[]) => createBooking(...args),
  createBookingPack: (...args: unknown[]) => createBookingPack(...args),
}));

const enforceRateLimit = vi.fn();
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: (...args: unknown[]) => enforceRateLimit(...args) }));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  requireTenant: async () => ({ tenant: { id: 't1', slug: 'ruiz', timezone: 'Europe/Madrid' }, scope: {} }),
}));

const { isTestRun } = await import('@/lib/test-run-server');
const { AuthError } = await import('@/lib/auth');
const { POST: book } = await import('@/app/api/t/[slug]/bookings/route');

function request(headers: Record<string, string>, body?: unknown) {
  return new Request('http://x/api/t/ruiz/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  requireTenantAdmin.mockReset();
  createBooking.mockReset();
  createBookingPack.mockReset();
  enforceRateLimit.mockReset();
});

describe('who may run a test', () => {
  it('is an ordinary request when it does not say it is a test, and asks nobody', async () => {
    expect(await isTestRun(request({}), 'ruiz')).toBe(false);
    expect(requireTenantAdmin).not.toHaveBeenCalled();
  });

  it('is a test for a signed-in admin of this business', async () => {
    requireTenantAdmin.mockResolvedValue({});
    expect(await isTestRun(request({ [TEST_HEADER]: '1' }), 'ruiz')).toBe(true);
    expect(requireTenantAdmin).toHaveBeenCalledWith(expect.any(Request), 'ruiz');
  });

  it('is refused, not quietly made real, for anyone else', async () => {
    requireTenantAdmin.mockRejectedValue(new AuthError('Sign in', 401));
    await expect(isTestRun(request({ [TEST_HEADER]: '1' }), 'ruiz')).rejects.toThrow('Sign in');
  });
});

describe('a test booking', () => {
  it('answers like a booking and books nothing', async () => {
    requireTenantAdmin.mockResolvedValue({});
    const res = await book(
      request({ [TEST_HEADER]: '1' }, { eventTypeId: 's1', startsAt: '2026-10-01T08:00:00Z', name: 'Maya', email: 'm@x.com' }),
      { params: Promise.resolve({ slug: 'ruiz' }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ test: true, booking: { startsAt: '2026-10-01T08:00:00Z', confirmationEmailSent: false } });
    expect(createBooking).not.toHaveBeenCalled();
    expect(createBookingPack).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it('is refused for somebody who only says it is a test', async () => {
    requireTenantAdmin.mockRejectedValue(new AuthError('Sign in', 401));
    const res = await book(
      request({ [TEST_HEADER]: '1' }, { eventTypeId: 's1', startsAt: '2026-10-01T08:00:00Z', name: 'M', email: 'm@x.com' }),
      { params: Promise.resolve({ slug: 'ruiz' }) },
    );
    expect(res.status).toBe(401);
    expect(createBooking).not.toHaveBeenCalled();
  });
});

describe('the route a test run walks', () => {
  it('maps each step of the page to a part of the flow', () => {
    expect(partForPhase('service')).toBe('page');
    expect(partForPhase('email')).toBe('questions');
    expect(partForPhase('other')).toBe('elsewhere');
    expect(partForPhase('review')).toBe('calendar');
    expect(partForPhase('confirmed')).toBe('booked');
  });

  it('carries the service in a test run’s stand-in response id, and nothing else passes for one', () => {
    expect(eventTypeOfTestResponse(testResponseId('svc-1'))).toBe('svc-1');
    expect(eventTypeOfTestResponse('0b8f3c1e-real-id')).toBeNull();
    expect(eventTypeOfTestResponse('test:')).toBeNull();
  });
});
