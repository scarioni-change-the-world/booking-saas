import { describe, expect, it } from 'vitest';
import {
  BRAND_PRESETS,
  brandAccent,
  brandRefusal,
  checkBrandColour,
  contrast,
  parseHex,
} from '../src/lib/brand-colour';

describe('parseHex', () => {
  it('normalises short and long forms, with or without #', () => {
    expect(parseHex('#ABC')).toBe('#aabbcc');
    expect(parseHex('2E5E7E')).toBe('#2e5e7e');
    expect(parseHex('  #2e5e7e ')).toBe('#2e5e7e');
  });
  it('refuses anything else', () => {
    expect(parseHex('blue')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('rgb(0,0,0)')).toBeNull();
  });
});

describe('contrast', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#2e5e7e', '#2e5e7e')).toBeCloseTo(1, 5);
  });
});

describe('checkBrandColour', () => {
  it('accepts every preset', () => {
    for (const p of BRAND_PRESETS) expect(checkBrandColour(p.hex).ok).toBe(true);
  });

  it('refuses Ochre itself and colours close to it', () => {
    for (const hex of ['#b9822b', '#a0661c', '#8a6a1a', '#9c5a20']) {
      const check = checkBrandColour(hex);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason).toBe('ochre');
    }
  });

  it('allows a warm grey, which no one reads as a warning', () => {
    expect(checkBrandColour('#5e5a54').ok).toBe(true);
  });

  it('refuses colours too pale for text on Soft White', () => {
    const check = checkBrandColour('#7fb3d5');
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe('pale');
      expect(brandRefusal(check)).toMatch(/too pale/);
    }
  });

  it('refuses a malformed code', () => {
    const check = checkBrandColour('teal');
    expect(check).toEqual({ ok: false, reason: 'format' });
  });

  it('reports the contrast it measured', () => {
    const check = checkBrandColour('#2e5e7e');
    expect(check.ok && check.contrast).toBeGreaterThan(6.5);
  });
});

describe('brandAccent', () => {
  it('passes a good colour through, normalised', () => {
    expect(brandAccent('#2E5E7E')).toBe('#2e5e7e');
  });
  it('falls back to Mineral (undefined) for anything the guard refuses', () => {
    expect(brandAccent('#b9822b')).toBeUndefined();
    expect(brandAccent('#eeeeee')).toBeUndefined();
    expect(brandAccent('nonsense')).toBeUndefined();
    expect(brandAccent(undefined)).toBeUndefined();
  });
});
