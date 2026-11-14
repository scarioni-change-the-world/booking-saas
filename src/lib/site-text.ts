/**
 * Reading a business's own website for "Set up from your website": its
 * words without the markup, the few pages worth reading besides the home
 * page, and the colour the site itself declares.
 *
 * Pure, so it is tested without a network. The fetching is site-fetch.ts,
 * which keeps every request to public addresses.
 */

/** About 12,000 words across all pages: a business site's services and prices, not its blog. */
export const MAX_SITE_CHARS = 60_000;
/** Pages read besides the home page. */
export const MAX_EXTRA_PAGES = 3;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  pound: '£',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * The words a visitor reads, one block per line: no scripts, styles,
 * navigation chrome hidden in <svg> or <template>, and no tags.
 */
export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const description = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|table|ul|ol|header|footer|main|dt|dd|blockquote)>/gi, '\n')
    .replace(/<(li|dt)\b[^>]*>/gi, '\n• ')
    .replace(/<(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ');
  const lines = decode(body)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l) => l && l !== '•' && l !== '|');
  // Menus repeat on every page; one copy of a line is enough.
  const seen = new Set<string>();
  const unique = lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
  const head = [title && decode(title).trim(), description && decode(description).trim()].filter(Boolean);
  return [...head, ...unique].join('\n');
}

/** Words in a link (its address or its text) that suggest services, prices or hours, in a few languages. */
const WORTH_READING =
  /servic|price|pricing|rates|fees|book|appointment|treatment|session|offer|hours|opening|contact|about|tarif|precio|servicio|cita|horario|leistung|angebot|preis|termin|öffnung|prestation|prix|horaire|prezzi|serviz|orari/i;

/**
 * Up to MAX_EXTRA_PAGES pages on the same site worth reading besides the
 * home page: the ones whose address or link text mentions services,
 * prices, booking or hours. Same host only; no files, no fragments.
 */
export function pagesWorthReading(html: string, baseUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const found: string[] = [];
  const anchors = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const [, href, inner] of anchors) {
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3)$/i.test(url.pathname)) continue;
    url.hash = '';
    const text = (inner ?? '').replace(/<[^>]+>/g, ' ');
    if (!WORTH_READING.test(url.pathname) && !WORTH_READING.test(text)) continue;
    const key = url.toString();
    if (key === base.toString() || found.includes(key)) continue;
    found.push(key);
    if (found.length >= MAX_EXTRA_PAGES) break;
  }
  return found;
}

/** The colour the site declares for itself (<meta name="theme-color">), if any. */
export function themeColour(html: string): string | null {
  const tag = /<meta[^>]+name=["']theme-color["'][^>]*>/i.exec(html)?.[0];
  const value = tag ? /content=["']([^"']+)["']/i.exec(tag)?.[1] : null;
  return value && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value.trim()) ? value.trim() : null;
}

/**
 * The pages as one text for the assistant, each under its address, cut at
 * MAX_SITE_CHARS in total. The home page comes first and keeps most room.
 */
export function siteDigest(pages: Array<{ url: string; text: string }>): string {
  let left = MAX_SITE_CHARS;
  const parts: string[] = [];
  for (const page of pages) {
    if (left <= 200) break;
    const text = page.text.slice(0, left);
    parts.push(`=== ${page.url} ===\n${text}`);
    left -= text.length;
  }
  return parts.join('\n\n');
}
