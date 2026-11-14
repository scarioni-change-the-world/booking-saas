import { describe, expect, it } from 'vitest';
import { signupFunnel } from '../src/lib/signup-funnel';

const t = (id: string, day: number) => ({ id, createdAt: new Date(Date.UTC(2026, 9, day)).toISOString() });
const at = (day: number) => new Date(Date.UTC(2026, 9, day)).toISOString();

describe('signupFunnel', () => {
  const input = {
    tenants: [t('a', 1), t('b', 1), t('c', 2), t('d', 3), t('e', 4), t('f', 5)],
    services: [
      { tenantId: 'a', createdAt: at(1), live: true },
      { tenantId: 'a', createdAt: at(2), live: false },
      { tenantId: 'b', createdAt: at(3), live: true },
      { tenantId: 'c', createdAt: at(4), live: false },
      { tenantId: 'zz', createdAt: at(4), live: true }, // a business outside the window
    ],
    bookings: [
      { tenantId: 'a', createdAt: at(6) },
      { tenantId: 'a', createdAt: at(3) },
    ],
    embedded: ['b'],
    unconfirmed: 4,
  };

  it('counts each step among those who passed the one before', () => {
    const f = signupFunnel(input);
    expect(f.steps.map((s) => [s.id, s.count])).toEqual([
      ['started', 10],
      ['confirmed', 6],
      ['service', 3],
      ['live', 2],
      ['shared', 2],
      ['booked', 1],
    ]);
    expect(f.steps[1]!.ofPrevious).toBeCloseTo(0.6);
    expect(f.steps[0]!.ofPrevious).toBeNull();
  });

  it('measures time to the first service and booking from joining', () => {
    const f = signupFunnel(input);
    // a: day 0, b: day 2, c: day 2 → median 2. First booking: a on day 3 → 2 days.
    expect(f.medianDaysToService).toBe(2);
    expect(f.medianDaysToBooking).toBe(2);
  });

  it('names the step that loses the most, once there are enough to say', () => {
    expect(signupFunnel(input).worst).toMatchObject({ from: 'confirmed', to: 'service' });
    const few = signupFunnel({ ...input, tenants: input.tenants.slice(0, 2), unconfirmed: 0 });
    expect(few.worst).toBeNull();
  });

  it('never widens: a booking counts as live and shared too', () => {
    const f = signupFunnel({ tenants: [t('x', 1)], services: [], bookings: [{ tenantId: 'x', createdAt: at(2) }], embedded: [], unconfirmed: 0 });
    expect(f.steps.map((s) => s.count)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});
