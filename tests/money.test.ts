import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  minorUnitDigits,
  parseMoney,
  parseOptionalMoney,
  toMoneyInput,
} from '@/lib/money';

describe('minorUnitDigits', () => {
  it('knows the ordinary two-decimal currencies', () => {
    expect(minorUnitDigits('EUR')).toBe(2);
    expect(minorUnitDigits('USD')).toBe(2);
    expect(minorUnitDigits('GBP')).toBe(2);
  });

  /* The whole reason this is a function rather than the constant 100. */
  it('knows the ones with no minor unit at all', () => {
    expect(minorUnitDigits('JPY')).toBe(0);
    expect(minorUnitDigits('KRW')).toBe(0);
  });

  it('falls back to two for something that is not a currency', () => {
    expect(minorUnitDigits('ZZZ')).toBe(2);
    expect(minorUnitDigits('')).toBe(2);
    expect(minorUnitDigits('not a code')).toBe(2);
  });
});

describe('formatMoney', () => {
  it('renders minor units as an amount a person reads', () => {
    expect(formatMoney(6000, 'EUR', 'en-IE')).toContain('60.00');
    expect(formatMoney(6050, 'EUR', 'en-IE')).toContain('60.50');
  });

  it('puts the symbol where the reader expects it', () => {
    const spanish = formatMoney(6000, 'EUR', 'es-ES');
    const american = formatMoney(6000, 'USD', 'en-US');
    expect(spanish).toMatch(/60,00/);
    expect(american).toBe('$60.00');
  });

  it('does not invent decimals for a currency that has none', () => {
    expect(formatMoney(6000, 'JPY', 'en-US')).toBe('¥6,000');
  });

  it('renders zero as zero, not as nothing', () => {
    expect(formatMoney(0, 'EUR', 'en-IE')).toContain('0.00');
  });

  /* The column is constrained to three upper-case letters, not to a real
     currency, so junk can reach here. A page that will not render is a worse
     answer than a slightly odd one. */
  it('still renders something for a code Intl has never heard of', () => {
    expect(formatMoney(6000, 'ZZZ')).toContain('60.00');
  });
});

describe('parseMoney', () => {
  it('reads what people actually type', () => {
    expect(parseMoney('60', 'EUR')).toBe(6000);
    expect(parseMoney('60.00', 'EUR')).toBe(6000);
    expect(parseMoney('60.5', 'EUR')).toBe(6050);
    expect(parseMoney('60.50', 'EUR')).toBe(6050);
    expect(parseMoney('0', 'EUR')).toBe(0);
  });

  /* Most of Europe — including where this is first being used — writes the
     decimal separator as a comma. */
  it('accepts a decimal comma', () => {
    expect(parseMoney('60,50', 'EUR')).toBe(6050);
  });

  it('ignores a currency symbol and spaces', () => {
    expect(parseMoney('€60', 'EUR')).toBe(6000);
    expect(parseMoney('60 €', 'EUR')).toBe(6000);
    expect(parseMoney(' 60.00 ', 'EUR')).toBe(6000);
  });

  it('counts whole units for a currency with no minor unit', () => {
    expect(parseMoney('6000', 'JPY')).toBe(6000);
  });

  /* "1,500" could be one thousand five hundred or one point five, and being
     wrong by a factor of a thousand is not a rounding error. */
  it('refuses a grouping separator rather than guessing which it is', () => {
    expect(parseMoney('1,500.00', 'EUR')).toBeNull();
    expect(parseMoney('1.500,00', 'EUR')).toBeNull();
  });

  /* Storing €61.00 for "60.999" is the kind of help nobody asked for. */
  it('refuses more precision than the currency has', () => {
    expect(parseMoney('60.999', 'EUR')).toBeNull();
    expect(parseMoney('60.5', 'JPY')).toBeNull();
  });

  it('refuses things that are not prices', () => {
    for (const bad of ['', 'free', '-60', '60.', '.60.', 'NaN', 'Infinity']) {
      expect(parseMoney(bad, 'EUR')).toBeNull();
    }
  });

  /* A space is never a decimal separator in any locale, so unlike a comma
     it carries no ambiguity: "1 500" is fifteen hundred wherever it is
     typed, and that is the grouping style across much of Europe. Stripping
     it is a reading, not a guess — which is exactly why the comma above is
     refused and this is not. */
  it('reads a space as grouping, because it can never be a decimal point', () => {
    expect(parseMoney('1 500', 'EUR')).toBe(150000);
    expect(parseMoney('1 500,50', 'EUR')).toBe(150050);
  });

  /* The float route would give 6050.000000000001 for some of these. */
  it('never goes through floating point', () => {
    for (let cents = 0; cents < 100; cents += 1) {
      const typed = `60.${String(cents).padStart(2, '0')}`;
      expect(parseMoney(typed, 'EUR')).toBe(6000 + cents);
    }
  });
});

describe('parseOptionalMoney', () => {
  /* Blank is a real answer — it is how a business says this service has no
     published price — so it cannot share a return value with an error. */
  it('tells a cleared field apart from a bad one', () => {
    expect(parseOptionalMoney('', 'EUR')).toEqual({ ok: true, minor: null });
    expect(parseOptionalMoney('   ', 'EUR')).toEqual({ ok: true, minor: null });
    expect(parseOptionalMoney('free', 'EUR')).toEqual({ ok: false });
    expect(parseOptionalMoney('60', 'EUR')).toEqual({ ok: true, minor: 6000 });
  });
});

describe('toMoneyInput', () => {
  it('round-trips through the form field without drift', () => {
    for (const minor of [0, 1, 99, 100, 6050, 123456, 100000000]) {
      expect(parseMoney(toMoneyInput(minor, 'EUR'), 'EUR')).toBe(minor);
    }
  });

  it('shows an unset price as an empty box', () => {
    expect(toMoneyInput(null, 'EUR')).toBe('');
  });

  it('writes no decimal point for a currency with no minor unit', () => {
    expect(toMoneyInput(6000, 'JPY')).toBe('6000');
  });
});
