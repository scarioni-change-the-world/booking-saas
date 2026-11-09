import Stripe from 'stripe';

/**
 * The Stripe client, and whether Stripe is set up at all.
 *
 * Unset keys are not an error for the rest of the app: a deployment without
 * Stripe keeps working exactly as before — businesses on trial or free
 * access, clients paying outside khloe — and only the screens that would
 * start a payment say it is not available yet.
 */

let cached: Stripe | null = null;

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  cached = new Stripe(key, { appInfo: { name: 'khloe' } });
  return cached;
}

/**
 * The Stripe price a business subscribes at: the founding price for a
 * founding business (plans.ts), the standard one for everybody else. A
 * founding business with no founding price configured gets null — it cannot
 * subscribe yet — rather than quietly being charged the standard price.
 */
export function subscriptionPriceId(founding = false): string | null {
  if (founding) return process.env.STRIPE_FOUNDING_PRICE_ID || null;
  return process.env.STRIPE_PRICE_ID || null;
}

export function automaticTax(): boolean {
  return process.env.STRIPE_AUTOMATIC_TAX === '1';
}

/** The two webhook signing secrets: this account's events, and connected accounts'. */
export function webhookSecrets(): string[] {
  return [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
    (s): s is string => !!s,
  );
}

/** Reset the memoised client. Tests only. */
export function __resetStripe(): void {
  cached = null;
}
