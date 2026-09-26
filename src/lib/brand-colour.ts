/**
 * A business's own colour on its booking page, and the rule that keeps it
 * inside the two colours.
 *
 * On a client's screen the business's colour takes Mineral's one job — where
 * you are: the step, the day and time chosen, the main key. Ochre keeps the
 * other job — something to fix — on every page, for every business. So a
 * colour is refused when it could be read as Ochre, or when it is too pale
 * to carry text and a key's edge on Soft White.
 */

export const OCHRE = '#b9822b';
export const SOFT_WHITE = '#fcfbf8';
/** Body text needs 4.5:1; a key's label is text. */
export const MIN_CONTRAST = 4.5;
/** Hues this close to Ochre's, and not grey, read as "needs fixing". */
const OCHRE_HUE_MARGIN = 28;
const GREY_SATURATION = 0.2;

export const BRAND_PRESETS = [
  { hex: '#566b68', label: 'Mineral' },
  { hex: '#2e5e7e', label: 'Slate blue' },
  { hex: '#5d4a72', label: 'Plum' },
  { hex: '#3d5a3a', label: 'Moss' },
  { hex: '#7a3b3b', label: 'Brick' },
  { hex: '#353a38', label: 'Granite' },
] as const;

export const DEFAULT_BRAND = BRAND_PRESETS[0].hex;

/** "#AbC" or "abcdef" → "#aabbcc"; anything else → null. */
export function parseHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw)) {
    return `#${raw
      .split('')
      .map((c) => c + c)
      .join('')}`;
  }
  return /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast between two colours, e.g. 7.02. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Hue in degrees and HSL saturation, 0–1. */
function hueSat(hex: string): { hue: number; sat: number } {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { hue: 0, sat: 0 };
  const sat = d / (1 - Math.abs(2 * l - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return { hue: (hue * 60 + 360) % 360, sat };
}

export type BrandCheck =
  | { ok: true; hex: string; contrast: number }
  | { ok: false; reason: 'format' | 'pale' | 'ochre'; hex?: string; contrast?: number };

export function checkBrandColour(input: string): BrandCheck {
  const hex = parseHex(input);
  if (!hex) return { ok: false, reason: 'format' };
  const ratio = Math.round(contrast(hex, SOFT_WHITE) * 10) / 10;
  const { hue, sat } = hueSat(hex);
  const ochreHue = hueSat(OCHRE).hue;
  const apart = Math.min(Math.abs(hue - ochreHue), 360 - Math.abs(hue - ochreHue));
  if (sat > GREY_SATURATION && apart < OCHRE_HUE_MARGIN) {
    return { ok: false, reason: 'ochre', hex, contrast: ratio };
  }
  if (ratio < MIN_CONTRAST) return { ok: false, reason: 'pale', hex, contrast: ratio };
  return { ok: true, hex, contrast: ratio };
}

/** What a refusal says, in the words the settings screen uses. */
export function brandRefusal(check: Exclude<BrandCheck, { ok: true }>): string {
  switch (check.reason) {
    case 'format':
      return 'Write it as a hex code, like #2E5E7E.';
    case 'ochre':
      return 'Too close to Ochre, which every page keeps for things that need fixing.';
    case 'pale':
      return `${check.contrast} : 1 on white — too pale for text and a button edge (needs ${MIN_CONTRAST}).`;
  }
}

/**
 * The colour a client page should use, or undefined for intro's Mineral.
 * A value saved before this rule existed, or written by hand, is checked
 * here too rather than trusted.
 */
export function brandAccent(accentColor?: string | null): string | undefined {
  if (!accentColor) return undefined;
  const check = checkBrandColour(accentColor);
  return check.ok ? check.hex : undefined;
}
