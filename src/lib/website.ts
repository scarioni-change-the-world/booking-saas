/**
 * A business's own website, as typed in Account: "mara.studio",
 * "www.mara.studio/coaching" or a full address. Shown on its booking page as
 * the way back to where the client came from, so it must be a plain web
 * address and nothing else — no javascript:, mailto: or other schemes.
 */

export const WEBSITE_MAX_LENGTH = 200;

export type WebsiteCheck = { ok: true; url: string | null } | { ok: false; message: string };

export function normaliseWebsite(input: unknown): WebsiteCheck {
  if (input === null || input === undefined) return { ok: true, url: null };
  if (typeof input !== 'string') return { ok: false, message: 'Write your website as a web address.' };
  const raw = input.trim();
  if (raw === '') return { ok: true, url: null };
  if (raw.length > WEBSITE_MAX_LENGTH) return { ok: false, message: 'That address is too long.' };

  // Most people type "mysite.com"; anything with its own scheme must be http(s).
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, message: 'That doesn’t look like a web address, e.g. www.yoursite.com.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, message: 'Use a website address starting with https://.' };
  }
  if (!url.hostname.includes('.') || url.username || url.password) {
    return { ok: false, message: 'That doesn’t look like a web address, e.g. www.yoursite.com.' };
  }
  const text = url.toString();
  return { ok: true, url: url.pathname === '/' && !url.search && !url.hash ? text.replace(/\/$/, '') : text };
}

/** "https://www.mara.studio/coaching" → "mara.studio": how the link reads. */
export function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
