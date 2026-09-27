'use client';

import { classifySource } from '@/lib/visit-source';

/**
 * Counting a visit to a booking page, and remembering where it came from
 * for the booking that may follow. Kept in sessionStorage — this tab only,
 * gone when it closes — so a reload is not a second visit and the source
 * survives the steps of the booking. Never a cookie, never an identifier.
 */

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* Private mode or storage blocked: the visit still counts, once per load. */
  }
}

/** Where this visitor came from, worked out once per tab. */
export function visitSource(slug: string, embedded: boolean): string {
  const key = `intro-source-${slug}`;
  const saved = read(key);
  if (saved) return saved;
  const source = classifySource({
    search: window.location.search,
    referrer: document.referrer,
    ownHost: window.location.host,
    embedded,
  });
  write(key, source);
  return source;
}

/** Count the visit, once per tab. Best effort: a failure is nobody's problem. */
export function recordVisit(
  slug: string,
  surface: 'page' | 'embedded' | 'client_link',
  source: string,
): void {
  const key = `intro-visit-${slug}-${surface}`;
  if (read(key)) return;
  write(key, '1');
  void fetch(`/api/t/${encodeURIComponent(slug)}/visit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, surface }),
    keepalive: true,
  }).catch(() => undefined);
}
