/**
 * How a service is recognised at a glance: a colour and a two-letter mark.
 *
 * With one service nothing needs telling apart. With three, "which box is
 * the wedding one" meant reading small print in a diagram, and a week of
 * bookings all drawn in the same green said nothing about what each one
 * was. So each service carries one colour everywhere it appears — its lane
 * on Flow, its bookings on the Week, its steps in People — and a mark
 * beside it, because colour alone fails anyone who cannot tell two of them
 * apart. The name is always there too; these only make it findable.
 *
 * Six colours, each dark enough to carry white text at 4.8:1 or better and
 * to stand as a line on the page. Six because five services is the soft
 * cap; the sixth leaves room for one archived and one new.
 */

export interface ServiceColour {
  hex: string;
  label: string;
}

export const SERVICE_PALETTE: readonly ServiceColour[] = [
  { hex: '#2c6a63', label: 'Teal' },
  { hex: '#8a5a12', label: 'Ochre' },
  { hex: '#7a4e7e', label: 'Plum' },
  { hex: '#2f6fae', label: 'Blue' },
  { hex: '#a4472f', label: 'Terracotta' },
  { hex: '#5a6b1f', label: 'Olive' },
];

export function isPaletteColour(value: string): boolean {
  return SERVICE_PALETTE.some((c) => c.hex === value.toLowerCase());
}

/**
 * The colour a service is drawn in. Anything not in the palette — the
 * column's old '#111111' default, or a value from before this existed —
 * falls back to the first colour rather than drawing a black lane.
 */
export function serviceColour(value: string | null | undefined): string {
  return value && isPaletteColour(value) ? value.toLowerCase() : SERVICE_PALETTE[0]!.hex;
}

/** The first colour no other service is using, for a new one. */
export function nextColour(inUse: readonly string[]): string {
  const taken = new Set(inUse.map((c) => c.toLowerCase()));
  return (SERVICE_PALETTE.find((c) => !taken.has(c.hex)) ?? SERVICE_PALETTE[inUse.length % SERVICE_PALETTE.length]!).hex;
}

/**
 * Two letters from the name: the first letters of its first two words, or
 * the first two letters of a one-word name. "Portrait session" is PS,
 * "Coaching" is CO. Punctuation and numbers are skipped, so "1:1 call" is
 * CA rather than "1:".
 */
export function monogram(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
