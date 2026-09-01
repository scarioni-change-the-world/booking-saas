import { describe, expect, it } from 'vitest';
import { parseBookingModeForCreate, parseBookingModeForUpdate } from '@/lib/admin-event-types';
import { BookingError } from '@/lib/booking-service';

describe('parseBookingModeForCreate', () => {
  it('defaults to single when nothing is said', () => {
    expect(parseBookingModeForCreate({})).toEqual({ bookingMode: 'single', packSize: null });
  });

  it('accepts an explicit single mode with no packSize', () => {
    expect(parseBookingModeForCreate({ bookingMode: 'single' })).toEqual({
      bookingMode: 'single',
      packSize: null,
    });
  });

  it('rejects a packSize sent alongside single', () => {
    expect(() => parseBookingModeForCreate({ bookingMode: 'single', packSize: 10 })).toThrow(
      BookingError,
    );
  });

  it('accepts pack mode with a valid packSize', () => {
    expect(parseBookingModeForCreate({ bookingMode: 'pack', packSize: 10 })).toEqual({
      bookingMode: 'pack',
      packSize: 10,
    });
  });

  it('requires a packSize for pack mode', () => {
    expect(() => parseBookingModeForCreate({ bookingMode: 'pack' })).toThrow(BookingError);
  });

  it.each([1, 11, 0, -3, 2.5])('rejects an out-of-range packSize (%s)', (bad) => {
    expect(() => parseBookingModeForCreate({ bookingMode: 'pack', packSize: bad })).toThrow(
      BookingError,
    );
  });

  it('rejects a bookingMode that is not single or pack', () => {
    expect(() => parseBookingModeForCreate({ bookingMode: 'monthly' })).toThrow(BookingError);
  });
});

describe('parseBookingModeForUpdate', () => {
  it('returns undefined when neither field is sent — no change', () => {
    expect(parseBookingModeForUpdate({})).toBeUndefined();
  });

  it('accepts bookingMode: single sent alone (packSize becomes null)', () => {
    expect(parseBookingModeForUpdate({ bookingMode: 'single' })).toEqual({
      bookingMode: 'single',
      packSize: null,
    });
  });

  it('rejects bookingMode: pack sent alone — no size to attach', () => {
    expect(() => parseBookingModeForUpdate({ bookingMode: 'pack' })).toThrow(BookingError);
  });

  it('rejects packSize sent alone — ambiguous without a mode', () => {
    expect(() => parseBookingModeForUpdate({ packSize: 8 })).toThrow(BookingError);
  });

  it('accepts both fields sent together', () => {
    expect(parseBookingModeForUpdate({ bookingMode: 'pack', packSize: 8 })).toEqual({
      bookingMode: 'pack',
      packSize: 8,
    });
  });
});
