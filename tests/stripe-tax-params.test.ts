import { afterEach, describe, expect, it } from 'vitest';
import { checkoutTaxParams } from '@/lib/stripe';

const keep = { ...process.env };
afterEach(() => {
  process.env = { ...keep };
});

describe('checkoutTaxParams', () => {
  it('sends nothing about tax when neither is switched on', () => {
    delete process.env.STRIPE_MANAGED_PAYMENTS;
    delete process.env.STRIPE_AUTOMATIC_TAX;
    expect(checkoutTaxParams()).toEqual({});
  });

  it('sends Stripe Tax settings with STRIPE_AUTOMATIC_TAX=1', () => {
    delete process.env.STRIPE_MANAGED_PAYMENTS;
    process.env.STRIPE_AUTOMATIC_TAX = '1';
    expect(checkoutTaxParams()).toMatchObject({ automatic_tax: { enabled: true }, tax_id_collection: { enabled: true } });
  });

  it('with Managed Payments, sends only managed_payments, never the parameters Stripe refuses with it', () => {
    process.env.STRIPE_MANAGED_PAYMENTS = '1';
    process.env.STRIPE_AUTOMATIC_TAX = '1';
    const params = checkoutTaxParams();
    expect(params).toEqual({ managed_payments: { enabled: true } });
    for (const refused of ['automatic_tax', 'tax_id_collection', 'customer_update']) {
      expect(params).not.toHaveProperty(refused);
    }
  });
});
