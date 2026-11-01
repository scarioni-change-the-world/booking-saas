import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Fetch the home page of a business's website, to see which tool made it
 * (builders.ts). The address is one the business typed, so this is a
 * server fetching a URL a user chose, and it is guarded like one:
 *
 *   - http and https only, default ports only;
 *   - every address the name resolves to must be public (no loopback,
 *     private, link-local or metadata ranges), checked again on every
 *     redirect, and at most three redirects;
 *   - five seconds, 600 KB, no cookies, nothing sent but a plain GET.
 *
 * Nothing it reads is returned to the caller except the tool's name, so
 * even a fetch that slipped past the checks would reveal nothing but
 * "Squarespace" or "not sure".
 */

const TIMEOUT_MS = 5000;
const MAX_BYTES = 600_000;
const MAX_REDIRECTS = 3;

export class SiteFetchError extends Error {}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Whether an IP address is one a public website could not be on. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return privateV4(ip);
  if (kind === 6) {
    const v6 = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return privateV4(mapped[1]!);
    return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
  }
  return true;
}

async function checkUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SiteFetchError('not a web address');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SiteFetchError('not a web address');
  if (url.port && url.port !== '80' && url.port !== '443') throw new SiteFetchError('unusual port');
  if (url.username || url.password) throw new SiteFetchError('credentials in address');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new SiteFetchError('address not found');
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new SiteFetchError('not a public address');
  return url;
}

export interface FetchedSite {
  html: string;
  headers: Record<string, string>;
  finalUrl: string;
}

export async function fetchSite(address: string): Promise<FetchedSite> {
  let url = await checkUrl(address);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'khloe-site-check/1.0 (+https://khloe.io)', accept: 'text/html' },
      cache: 'no-store',
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      await response.body?.cancel();
      if (!next) throw new SiteFetchError('redirect without a destination');
      url = await checkUrl(new URL(next, url).toString());
      continue;
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { html: await readCapped(response), headers, finalUrl: url.toString() };
  }
  throw new SiteFetchError('too many redirects');
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}
