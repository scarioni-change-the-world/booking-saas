/**
 * Money.
 *
 * One rule, from which everything else here follows: an amount is an integer
 * number of a currency's smallest unit, and it is never a float. 0.1 + 0.2
 * is 0.30000000000000004 in binary floating point, and a price that does not
 * add up is the one class of bug nobody forgives in a product that handles
 * other people's fees.
 *
 * "Minor units", not "cents", because the number of them in a major unit is
 * a property of the currency: JPY and KRW have none, most have two, a few
 * have three. Rather than keep a table of exponents that will be wrong the
 * first time somebody uses a currency nobody thought of, this asks
 * Intl.NumberFormat, which already carries the whole of ISO 4217 and is
 * maintained by somebody else.
 */

/** Anything outside this is not a currency code, whatever it is. */
const ISO_4217 = /^[A-Z]{3}$/;

export const DEFAULT_CURRENCY = 'EUR';

/**
 * How many minor units make one major unit — 2 for EUR, 0 for JPY.
 *
 * Falls back to 2 for a code Intl does not recognise rather than throwing.
 * The database constrains the column to three upper-case letters, not to a
 * real currency, so "ZZZ" can reach this; two decimal places is the
 * overwhelmingly common shape, and a slightly wrong rendering beats a page
 * that will not render.
 */
export function minorUnitDigits(currency: string): number {
  if (!ISO_4217.test(currency)) return 2;
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/**
 * Render an amount for a person to read: 6000 EUR → "€60.00".
 *
 * The division happens here, at the very edge, on a value that is about to
 * become a string and never be arithmetic again — which is the only place
 * floating point is safe with money.
 *
 * `locale` decides where the symbol sits and which separators are used, so
 * a Spanish visitor sees "60,00 €" and an American "€60.00" for the same
 * stored number. Passing undefined uses the viewer's own, which is what
 * every caller on the client should do.
 */
export function formatMoney(minor: number, currency: string, locale?: string): string {
  const safeCurrency = ISO_4217.test(currency) ? currency : DEFAULT_CURRENCY;
  const digits = minorUnitDigits(safeCurrency);

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: safeCurrency,
    }).format(minor / 10 ** digits);
  } catch {
    // An unrecognised currency reached Intl despite the guard above. Show
    // the number and the code rather than nothing at all.
    return `${(minor / 10 ** digits).toFixed(digits)} ${safeCurrency}`;
  }
}

/**
 * Read what somebody typed into a price box, and return minor units.
 *
 * Deliberately forgiving about the things people actually type — a currency
 * symbol, spaces, a comma for the decimal point (which is the norm across
 * most of Europe, including the first place this product is being used) —
 * and deliberately strict about everything else. null means "that is not a
 * price", and the caller says so rather than storing a guess.
 *
 * An empty string is `null` too, and callers distinguish "cleared the field"
 * from "typed nonsense" before reaching here: see parseOptionalMoney.
 *
 * More precision than the currency has is rejected rather than rounded.
 * "60.999" in a two-decimal currency is a typo or a misunderstanding, and
 * silently storing €61.00 for it is the kind of help nobody asked for.
 */
export function parseMoney(input: string, currency: string): number | null {
  const digits = minorUnitDigits(currency);

  // Strip currency symbols and spaces, and normalise the decimal comma.
  //
  // Spaces go because a space is never a decimal separator in any locale —
  // "1 500" is fifteen hundred wherever it is typed, which is the grouping
  // style across much of Europe. Removing it is a reading, not a guess.
  //
  // A comma is the opposite: in most of Europe it IS the decimal point, so
  // "1,500" could be fifteen hundred or one and a half. Being wrong by a
  // factor of a thousand is not a rounding error, so it is normalised to a
  // decimal point and anything with a second separator is refused below
  // rather than resolved by guessing.
  const cleaned = input
    .replace(/[\s  ]/g, '')
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');

  if (cleaned === '') return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;

  const [whole, fraction = ''] = cleaned.split('.');
  if (fraction.length > digits) return null;

  const padded = fraction.padEnd(digits, '0');
  const minor = Number(`${whole}${padded}`);

  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * The form-field version: tells "left blank" apart from "typed something
 * that isn't a price".
 *
 * Blank is a real, meaningful answer here — it is how a business says this
 * service has no published price — so it cannot share a return value with
 * an error.
 */
export function parseOptionalMoney(
  input: string,
  currency: string,
): { ok: true; minor: number | null } | { ok: false } {
  if (input.trim() === '') return { ok: true, minor: null };

  const minor = parseMoney(input, currency);
  return minor === null ? { ok: false } : { ok: true, minor };
}

/** Minor units back to the string a price box should show for editing. */
export function toMoneyInput(minor: number | null, currency: string): string {
  if (minor === null) return '';
  const digits = minorUnitDigits(currency);
  if (digits === 0) return String(minor);

  const major = Math.floor(minor / 10 ** digits);
  const rest = String(minor % 10 ** digits).padStart(digits, '0');
  return `${major}.${rest}`;
}
