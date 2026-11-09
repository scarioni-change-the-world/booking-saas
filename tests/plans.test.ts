import { afterEach, describe, expect, it } from 'vitest';
import { TRIAL_DAYS, foundingOfferOpen, monthlyPrice, trialEndsAt } from '@/lib/plans';

afterEach(() => {
  delete process.env.FOUNDING_SEATS;
  delete process.env.FOUNDING_UNTIL;
});

describe('plans', () => {
  it('gives 30 days free', () => {
    expect(TRIAL_DAYS).toBe(30);
    const from = new Date('2026-11-09T10:00:00Z');
    expect(trialEndsAt(from)).toBe('2026-12-09T10:00:00.000Z');
  });

  it('says the price with VAT included', () => {
    expect(monthlyPrice(false)).toBe('€15 a month, VAT included');
    expect(monthlyPrice(true)).toBe('€9 a month, VAT included');
  });

  it('keeps the founding offer open for the first 100 by default', () => {
    expect(foundingOfferOpen(0)).toBe(true);
    expect(foundingOfferOpen(99)).toBe(true);
    expect(foundingOfferOpen(100)).toBe(false);
  });

  it('follows FOUNDING_SEATS and FOUNDING_UNTIL', () => {
    process.env.FOUNDING_SEATS = '0';
    expect(foundingOfferOpen(0)).toBe(false);
    process.env.FOUNDING_SEATS = '10';
    process.env.FOUNDING_UNTIL = '2026-12-31';
    expect(foundingOfferOpen(3, new Date('2026-12-31T20:00:00Z'))).toBe(true);
    expect(foundingOfferOpen(3, new Date('2027-01-01T00:00:01Z'))).toBe(false);
  });
});
