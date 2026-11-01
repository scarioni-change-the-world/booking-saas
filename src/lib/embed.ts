/**
 * Which sites may frame a tenant's booking widget.
 *
 * Every value here ends up inside a Content-Security-Policy header, joined
 * with spaces into `frame-ancestors`. That makes this file a header-injection
 * surface: a stored value containing a space or a semicolon would not be a
 * malformed hostname, it would be a second CSP directive of the attacker's
 * choosing, written by us and served to every visitor of that tenant's page.
 *
 * So validation is a strict allowlist of shapes rather than a blocklist of
 * dangerous characters. A hostname that cannot be expressed as
 * [*.]label(.label)+[:port] does not get stored, whatever it is — and
 * nothing that passes can contain a space, a semicolon, a quote or a
 * control character, because the grammar has no room for one.
 *
 * The scheme is added by us at render time and never stored, which removes
 * the other half of the problem: a tenant cannot store `javascript:` or
 * `data:` because they cannot store a scheme at all.
 */

/** A single hostname label: alphanumeric, inner hyphens allowed. */
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST = new RegExp(`^(\\*\\.)?${LABEL}(\\.${LABEL})+(:\\d{1,5})?$`);

/** More than this and a tenant is not embedding, they are collecting. */
export const MAX_EMBED_DOMAINS = 20;

/**
 * Normalise one entry, or return null if it cannot be one.
 *
 * Deliberately forgiving about how someone types it — people paste
 * "https://www.example.com/book" out of an address bar — and completely
 * unforgiving about what gets stored.
 */
export function normaliseEmbedDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;

  // A pasted URL: take the host and drop everything else. Done by hand
  // rather than with URL() because a bare "example.com" is not a valid URL
  // and would throw, and prefixing a scheme to find out changes what we are
  // validating.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split('/')[0]!;
  value = value.split('?')[0]!;
  value = value.split('#')[0]!;

  // A trailing dot is a valid fully-qualified host but not valid in CSP.
  if (value.endsWith('.')) value = value.slice(0, -1);

  if (value.length > 253) return null;
  // A bare wildcard would let any site on earth frame this tenant's page,
  // which is the one outcome this whole mechanism exists to prevent.
  if (value === '*' || value.startsWith('*.*')) return null;
  if (!HOST.test(value)) return null;

  return value;
}

/**
 * Clean a submitted list: normalise, drop anything invalid, de-duplicate,
 * and keep the order the tenant typed.
 *
 * Returns the rejects too, so the interface can say which line it could not
 * use rather than silently swallowing a typo — a domain that quietly failed
 * to save looks identical to one that saved and does not work.
 */
export function normaliseEmbedDomains(inputs: readonly string[]): {
  domains: string[];
  rejected: string[];
} {
  const domains: string[] = [];
  const rejected: string[] = [];

  for (const raw of inputs) {
    if (!raw.trim()) continue;
    const value = normaliseEmbedDomain(raw);
    if (!value) {
      rejected.push(raw.trim());
      continue;
    }
    if (!domains.includes(value)) domains.push(value);
  }

  return { domains: domains.slice(0, MAX_EMBED_DOMAINS), rejected };
}

/**
 * The frame-ancestors value for a tenant.
 *
 * 'self' always, and the tenant's own domains beside it. 'self' is this
 * app framing its own booking page — Flow's test run, which walks the real
 * page beside the flow. It lets no other site in: a tenant who has not said
 * who may embed their page has said nobody else may.
 *
 * https only. A booking form asking for someone's name and email inside an
 * unencrypted page is a problem regardless of who framed it, and pinning
 * the scheme here means a stored host can never be reached over http.
 */
export function frameAncestors(domains: readonly string[]): string {
  return ["'self'", ...domains.map((d) => `https://${d}`)].join(' ');
}

/**
 * The business's own website (Account → Your website), as frame hosts: its
 * host and the same host with or without "www.", since sites answer on
 * both. Run through the same strict shape as a typed domain, so nothing
 * reaches the header that could not have been typed into the list.
 *
 * Allowed without being listed because it is the one site the business has
 * already told us is theirs — and the place their clients come from.
 */
export function websiteFrameHosts(websiteUrl?: string | null): string[] {
  if (!websiteUrl) return [];
  const host = normaliseEmbedDomain(websiteUrl);
  if (!host || host.startsWith('*.')) return [];
  const twin = normaliseEmbedDomain(host.startsWith('www.') ? host.slice(4) : `www.${host}`);
  return twin && twin !== host ? [host, twin] : [host];
}

/** Everything allowed to frame the page: the typed list, then the website. */
export function allowedFrameHosts(listed: readonly string[], websiteUrl?: string | null): string[] {
  const all = [...listed];
  for (const h of websiteFrameHosts(websiteUrl)) if (!all.includes(h)) all.push(h);
  return all;
}

/**
 * Whether a host is covered by an allowed list, the way a browser reads
 * frame-ancestors: an exact match, or "*.example.com" for any subdomain of
 * example.com (not example.com itself).
 */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => (a.startsWith('*.') ? h.endsWith(a.slice(1)) : h === a));
}

/**
 * The page a sighting was reported from, cut to what Share shows: the
 * address without query or fragment (they can carry anything), http(s)
 * only, and its host in the shape of an allowed-site entry.
 */
export function sightingPage(raw: unknown): { host: string; pageUrl: string } | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = normaliseEmbedDomain(url.hostname);
  if (!host || host.startsWith('*.')) return null;
  const pageUrl = `${url.protocol}//${url.host}${url.pathname}`.slice(0, 300);
  return { host, pageUrl };
}

/**
 * The snippet a tenant pastes into their own site.
 *
 * An iframe plus one script tag. The script is what makes the difference
 * between an embed that works and one that technically works: the widget
 * changes height enormously between choosing a service, answering questions
 * and picking a time, and a fixed-height frame either scrolls inside itself
 * — miserable on a phone — or cuts the confirmation off.
 */
export function embedSnippet(baseUrl: string, slug: string, service?: string | null): string {
  // One service only (Share's picker): the page starts on it, list one step back.
  const src = `${baseUrl}/t/${slug}${service ? `?service=${encodeURIComponent(service)}` : ''}`;
  return [
    `<iframe`,
    `  src="${src}"`,
    `  title="Book an appointment"`,
    `  style="width:100%;border:0;min-height:520px"`,
    `  loading="lazy"`,
    `></iframe>`,
    `<script src="${baseUrl}/embed.js" async></script>`,
  ].join('\n');
}
