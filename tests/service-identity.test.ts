import { describe, expect, it } from 'vitest';
import { SERVICE_PALETTE, isPaletteColour, monogram, nextColour, serviceColour } from '@/lib/service-identity';

describe('monogram', () => {
  it('takes the first letters of the first two words', () => {
    expect(monogram('Portrait session')).toBe('PS');
    expect(monogram('wedding coverage for two')).toBe('WC');
  });
  it('takes two letters of a one-word name', () => {
    expect(monogram('Coaching')).toBe('CO');
  });
  it('skips numbers and punctuation, and keeps accented letters', () => {
    expect(monogram('1:1 call')).toBe('CA');
    expect(monogram('Ética laboral')).toBe('ÉL');
  });
  it('still gives something for a name with no letters', () => {
    expect(monogram('123')).toBe('?');
  });
});

describe('colours', () => {
  it('gives a new service the first colour nobody is using', () => {
    expect(nextColour([])).toBe(SERVICE_PALETTE[0]!.hex);
    expect(nextColour([SERVICE_PALETTE[0]!.hex, SERVICE_PALETTE[1]!.hex.toUpperCase()])).toBe(SERVICE_PALETTE[2]!.hex);
  });
  it('cycles once all six are taken, rather than failing', () => {
    expect(isPaletteColour(nextColour(SERVICE_PALETTE.map((c) => c.hex)))).toBe(true);
  });
  it('draws an unset or foreign colour as the first one, never black', () => {
    expect(serviceColour('#111111')).toBe(SERVICE_PALETTE[0]!.hex);
    expect(serviceColour(null)).toBe(SERVICE_PALETTE[0]!.hex);
    expect(serviceColour('#7A4E7E')).toBe('#7a4e7e');
  });
});
