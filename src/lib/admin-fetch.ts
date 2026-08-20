'use client';

import { supabaseBrowser } from './supabase-browser';

/**
 * fetch(), with the signed-in person's session attached as a bearer token.
 *
 * Every admin API route checks that token against tenant_members before
 * doing anything (see requireTenantAdmin) — this is just the browser side of
 * handing it over, so admin pages call this instead of repeating "get the
 * session, read its token, set the header" on every request.
 */
export async function adminFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;

  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

/** adminFetch, parsed as JSON, throwing the API's own error message on failure. */
export async function adminFetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await adminFetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'Request failed');
  return body as T;
}
