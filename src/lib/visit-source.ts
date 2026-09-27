/**
 * Where a visitor to a booking page came from, as one short label.
 *
 * Read from what the browser already says — a `?ref=` or `utm_source` the
 * business put on its own link, else the site that linked — and nothing
 * else: no cookie, no identifier, no address. The label is what Reports
 * groups by, so it is kept to a small, readable vocabulary: the platforms
 * a practice actually posts on, "email", the host of any other site (their
 * own website, a directory), "your website" for the embedded page, and
 * "direct" when nothing said.
 */

const PLATFORMS: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)(facebook\.com|fb\.me|fb\.com|messenger\.com)$/, 'facebook'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'],
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, 'x'],
  [/(^|\.)(tiktok\.com)$/, 'tiktok'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'whatsapp'],
  [/(^|\.)(pinterest\.[a-z.]+|pin\.it)$/, 'pinterest'],
  [/(^|\.)(threads\.net)$/, 'threads'],
  [
    /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|mail\.yahoo\.com|mail\.proton\.me)$/,
    'email',
  ],
  [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)(bing\.com|duckduckgo\.com|ecosia\.org|search\.yahoo\.com)$/, 'search'],
];

/** A label a business typed into its own link: kept, but tidied. */
function tidy(value: string): string | null {
  const cleaned = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._ -]+/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 40)
    .trim();
  return cleaned || null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export interface SourceInput {
  /** The page's own query string: `?ref=instagram`, `?utm_source=newsletter`. */
  search: string;
  /** document.referrer — empty when the browser does not say. */
  referrer: string;
  /** This app's own host: a referrer from here is a visitor moving between pages, not a source. */
  ownHost: string;
  embedded: boolean;
}

export function classifySource(input: SourceInput): string {
  const params = new URLSearchParams(input.search);
  const tagged = params.get('ref') ?? params.get('utm_source') ?? params.get('source');
  if (tagged) {
    const label = tidy(tagged);
    if (label) {
      for (const [pattern, name] of PLATFORMS) if (pattern.test(label) || label === name) return name;
      if (label === 'ig') return 'instagram';
      if (label === 'fb') return 'facebook';
      if (label === 'newsletter' || label === 'mail') return 'email';
      return label;
    }
  }

  const host = input.referrer ? hostOf(input.referrer) : null;
  const own = input.ownHost.toLowerCase().replace(/^www\./, '');
  if (input.embedded) return host && host !== own ? host : 'your website';
  if (!host || host === own) return 'direct';
  for (const [pattern, name] of PLATFORMS) if (pattern.test(host)) return name;
  return host.slice(0, 60);
}

/** How a label reads in Reports. */
export function sourceLabel(source: string | null | undefined): string {
  switch (source ?? 'direct') {
    case 'direct':
      return 'Direct or unknown';
    case 'client_link':
      return 'Their own link';
    case 'instagram':
      return 'Instagram';
    case 'facebook':
      return 'Facebook';
    case 'linkedin':
      return 'LinkedIn';
    case 'x':
      return 'X';
    case 'tiktok':
      return 'TikTok';
    case 'youtube':
      return 'YouTube';
    case 'whatsapp':
      return 'WhatsApp';
    case 'pinterest':
      return 'Pinterest';
    case 'threads':
      return 'Threads';
    case 'google':
      return 'Google';
    case 'search':
      return 'Other search engines';
    case 'email':
      return 'Email';
    case 'your website':
      return 'Your website';
    default:
      return source!;
  }
}

/** A label from a request body, made safe to store — or null. */
export function cleanSource(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._ -]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || null;
}
