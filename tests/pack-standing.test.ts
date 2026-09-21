import { describe, expect, it, vi } from 'vitest';
import { packStanding } from '@/lib/booking-service';

/**
 * What a programme still owes.
 *
 * The rule is a subtraction, and the reason it is worth its own test is the
 * alternative it replaces: a stored "sessions remaining" counter, which has
 * to be decremented on booking, incremented on cancel, left alone on
 * reschedule, and repaired by hand the first time any of those half-fails.
 * A count of confirmed rows cannot drift from the confirmed rows.
 */

function scopeReturning(rows: unknown[]) {
  const chain = {
    eq: () => chain,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return { select: () => chain } as never;
}

const row = (startsAt: string, status: 'confirmed' | 'cancelled', packSize = 3) => ({
  starts_at: startsAt,
  status,
  pack_size: packSize,
});

describe('packStanding', () => {
  it('owes nothing while every appointment is held', async () => {
    const standing = await packStanding(
      scopeReturning([
        row('2026-10-06T09:00:00Z', 'confirmed'),
        row('2026-10-09T09:00:00Z', 'confirmed'),
        row('2026-10-13T09:00:00Z', 'confirmed'),
      ]),
      'pack-1',
    );

    expect(standing).toMatchObject({ size: 3, booked: 3, remaining: 0 });
  });

  /* The hole this closes. Before, cancelling session two of three simply
     lost it: the client had paid for three, held two, and had nowhere to go. */
  it('owes one the moment an appointment is cancelled', async () => {
    const standing = await packStanding(
      scopeReturning([
        row('2026-10-06T09:00:00Z', 'confirmed'),
        row('2026-10-09T09:00:00Z', 'cancelled'),
        row('2026-10-13T09:00:00Z', 'confirmed'),
      ]),
      'pack-1',
    );

    expect(standing).toMatchObject({ size: 3, booked: 2, remaining: 1 });
  });

  it('owes two when two are cancelled', async () => {
    const standing = await packStanding(
      scopeReturning([
        row('2026-10-06T09:00:00Z', 'cancelled'),
        row('2026-10-09T09:00:00Z', 'cancelled'),
        row('2026-10-13T09:00:00Z', 'confirmed'),
      ]),
      'pack-1',
    );

    expect(standing?.remaining).toBe(2);
  });

  /* Booking a replacement adds a row rather than reviving the cancelled one,
     so a repaired programme has four rows for three appointments — and must
     still owe nothing. */
  it('is whole again once a replacement is booked, cancelled row and all', async () => {
    const standing = await packStanding(
      scopeReturning([
        row('2026-10-06T09:00:00Z', 'confirmed'),
        row('2026-10-09T09:00:00Z', 'cancelled'),
        row('2026-10-13T09:00:00Z', 'confirmed'),
        row('2026-10-16T09:00:00Z', 'confirmed'),
      ]),
      'pack-1',
    );

    expect(standing).toMatchObject({ size: 3, booked: 3, remaining: 0 });
  });

  /* Never negative, however the rows got that way — a business adding an
     appointment by hand must not make the number read as a debt to the
     client. */
  it('never reports a negative debt', async () => {
    const standing = await packStanding(
      scopeReturning([
        row('2026-10-06T09:00:00Z', 'confirmed'),
        row('2026-10-09T09:00:00Z', 'confirmed'),
        row('2026-10-13T09:00:00Z', 'confirmed'),
        row('2026-10-16T09:00:00Z', 'confirmed'),
      ]),
      'pack-1',
    );

    expect(standing?.remaining).toBe(0);
  });

  it('lists every appointment, cancelled ones included', async () => {
    const standing = await packStanding(
      scopeReturning([
        row('2026-10-06T09:00:00Z', 'confirmed'),
        row('2026-10-09T09:00:00Z', 'cancelled'),
      ]),
      'pack-1',
    );

    expect(standing?.appointments).toHaveLength(2);
    expect(standing?.appointments[1]).toMatchObject({ status: 'cancelled' });
  });

  it('has nothing to say about a pack id with no bookings', async () => {
    expect(await packStanding(scopeReturning([]), 'nope')).toBeNull();
  });
});
