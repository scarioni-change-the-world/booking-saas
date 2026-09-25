import { describe, expect, it } from 'vitest';
import { SERVICE_PALETTE, isPaletteColour, monogram, nextColour, serviceColour, uniqueMonograms } from '@/lib/service-identity';

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

describe('uniqueMonograms', () => {
  const at = (day: number) => `2026-01-${String(day).padStart(2, '0')}T00:00:00Z`;

  it('keeps the usual marks when nothing clashes', () => {
    const marks = uniqueMonograms([
      { name: 'Discovery call', createdAt: at(1) },
      { name: 'Career coaching programme', createdAt: at(2) },
    ]);
    expect(marks.get('Discovery call')).toBe('DC');
    expect(marks.get('Career coaching programme')).toBe('CC');
  });

  it('lets the older service keep its mark and moves the newer one', () => {
    const marks = uniqueMonograms([
      { name: 'CV check', createdAt: at(3) },
      { name: 'Career coaching', createdAt: at(1) },
    ]);
    expect(marks.get('Career coaching')).toBe('CC');
    expect(marks.get('CV check')).toBe('CV');
  });

  it('never repeats a mark, however alike the names', () => {
    const names = ['Coaching', 'Coaching online', 'Coaching in person', 'Coaching for teams', 'Couples'];
    const marks = uniqueMonograms(names.map((name, i) => ({ name, createdAt: at(i + 1) })));
    expect(new Set(marks.values()).size).toBe(names.length);
    expect(marks.get('Coaching')).toBe('CO');
  });

  it('falls back to a digit when the letters run out', () => {
    const marks = uniqueMonograms([
      { name: 'Ab', createdAt: at(1) },
      { name: 'A b', createdAt: at(2) },
    ]);
    expect(marks.get('Ab')).toBe('AB');
    expect(marks.get('A b')).toBe('A2');
  });
});
