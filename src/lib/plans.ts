/**
 * What khloe costs, in one place: the trial, the price, and the founding
 * price for the businesses that joined early.
 *
 * The amounts here are what the interface says. What Stripe charges comes
 * from the Stripe prices (STRIPE_PRICE_ID, STRIPE_FOUNDING_PRICE_ID), both
 * created tax-inclusive, so the two must be kept the same by hand.
 */

/** Days of full access from sign-up, with nothing to pay. */
export const TRIAL_DAYS = 30;

/** The monthly price, VAT included, as shown. */
export const STANDARD_PRICE = '€15';

/**
 * The founding price: for businesses that signed up while the founding
 * offer was open, for as long as they keep the account.
 */
export const FOUNDING_PRICE = '€9';

/** How many businesses can get the founding price, unless FOUNDING_SEATS says otherwise. */
const DEFAULT_FOUNDING_SEATS = 100;

export function trialEndsAt(from = new Date()): string {
  return new Date(from.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function monthlyPrice(founding: boolean): string {
  return `${founding ? FOUNDING_PRICE : STANDARD_PRICE} a month, VAT included`;
}

/**
 * Whether a business signing up now gets the founding price: while fewer
 * than FOUNDING_SEATS businesses have it, and, if FOUNDING_UNTIL is set
 * (a date, YYYY-MM-DD), until the end of that day. FOUNDING_SEATS=0 closes
 * the offer.
 */
export function foundingOfferOpen(foundingSoFar: number, now = new Date()): boolean {
  const seatsRaw = process.env.FOUNDING_SEATS?.trim();
  const seats = seatsRaw && /^\d+$/.test(seatsRaw) ? Number(seatsRaw) : DEFAULT_FOUNDING_SEATS;
  if (foundingSoFar >= seats) return false;

  const until = process.env.FOUNDING_UNTIL?.trim();
  if (until && /^\d{4}-\d{2}-\d{2}$/.test(until)) {
    const end = new Date(`${until}T23:59:59Z`);
    if (now.getTime() > end.getTime()) return false;
  }
  return true;
}
