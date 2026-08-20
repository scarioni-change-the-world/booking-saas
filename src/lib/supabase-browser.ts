'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The browser's own Supabase client — for the admin login page and dashboard
 * only. Signs a person in, holds their session, and hands out the access
 * token that admin API calls send as `Authorization: Bearer <token>`.
 *
 * Uses the anon key, which grants no table access by itself (see the RLS
 * policies in supabase/migrations/0005_rls.sql) — this client can only ever
 * authenticate, never read or write data directly.
 */

let cached: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. See .env.example.',
    );
  }

  cached = createClient(url, key);
  return cached;
}
