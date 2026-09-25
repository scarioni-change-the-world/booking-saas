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

/**
 * Every pair of letters a name could go by, best first: its usual mark,
 * then its first letter with the first letter of each later word, then
 * its first letter with each later letter, then its first letter and a
 * digit. "CV check" is CC, then CV.
 */
function markCandidates(name: string): string[] {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, '').toUpperCase())
    .filter(Boolean);
  const out = [monogram(name)];
  if (words.length === 0) return out;
  const first = words[0]![0]!;
  for (const word of words.slice(1)) out.push(first + word[0]!);
  for (const letter of [...words.join('')].slice(1)) out.push(first + letter);
  for (let digit = 2; digit <= 9; digit++) out.push(`${first}${digit}`);
  return [...new Set(out)];
}

/**
 * A mark for every service that no other service shares.
 *
 * Without a colour, the two letters are the only way to tell services
 * apart at a glance, so two can never share them. The oldest service keeps
 * its usual mark and a newer one that would repeat it takes its next
 * candidate, so adding a service never changes the marks people already
 * know. Keyed by name, because that is what bookings carry; two services
 * with the very same name share a mark as they share everything else.
 */
export function uniqueMonograms(
  services: ReadonlyArray<{ name: string; createdAt?: string | null }>,
): Map<string, string> {
  const ordered = [...services].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const taken = new Set<string>();
  const marks = new Map<string, string>();
  for (const service of ordered) {
    if (marks.has(service.name)) continue;
    const mark = markCandidates(service.name).find((c) => !taken.has(c)) ?? monogram(service.name);
    taken.add(mark);
    marks.set(service.name, mark);
  }
  return marks;
}
