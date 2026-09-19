'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/lib/admin-fetch';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Check =
  | { state: 'checking' }
  | { state: 'denied' }
  | { state: 'gated' }
  | { state: 'misconfigured'; detail: string }
  | { state: 'ok'; tenantName: string };

/**
 * The gate every admin page sits behind.
 *
 * There is no server-side session here — Supabase's browser client keeps the
 * signed-in state in the browser itself, not in a cookie this server reads —
 * so the check happens client-side, after the page has already started
 * rendering, rather than before anything reaches the browser. That trades a
 * brief "Checking access…" flash for not having to build cookie-based
 * server sessions tonight. Worth revisiting once the dashboard is more than
 * a first pass.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [check, setCheck] = useState<Check>({ state: 'checking' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Same reasoning as the console layout: supabaseBrowser() throws when
      // the NEXT_PUBLIC_ variables never made it into the build, and an
      // uncaught throw here leaves the page on "Checking access…" for ever
      // rather than saying what is wrong.
      let session;
      try {
        ({ data: session } = await supabaseBrowser().auth.getSession());
      } catch (cause) {
        setCheck({ state: 'misconfigured', detail: (cause as Error).message });
        return;
      }

      if (!session.session) {
        router.replace('/admin/login');
        return;
      }

      try {
        // adminFetch directly, not adminFetchJson, so the 402 that
        // requireTenantAdmin's gate check produces (see auth.ts) can be told
        // apart from a 401/404 — those two both mean "you don't belong
        // here, go sign in as someone who does", but a real member of a
        // gated tenant needs a different message entirely.
        const response = await adminFetch(`/api/admin/${slug}/me`);
        if (response.status === 402) {
          if (!cancelled) setCheck({ state: 'gated' });
          return;
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error();
        if (!cancelled) setCheck({ state: 'ok', tenantName: (body as { name: string }).name });
      } catch {
        // Signed in, but not as someone who administers this tenant —
        // sending them to login rather than a bare error lets them switch
        // accounts if they meant to.
        if (!cancelled) {
          setCheck({ state: 'denied' });
          router.replace('/admin/login');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, router]);

  if (check.state === 'misconfigured') {
    return (
      <main className="widget" style={{ paddingTop: 60 }}>
        <h1>Not configured</h1>
        <p className="notice notice-error" role="alert">
          {check.detail}
        </p>
        <p className="tz">
          The <code>NEXT_PUBLIC_</code> variables are baked in at build time,
          so setting them is not enough on its own — redeploy afterwards.{' '}
          <a href="/api/health">/api/health</a> reports what is configured.
        </p>
      </main>
    );
  }

  if (check.state === 'checking' || check.state === 'denied') {
    return (
      <main className="widget" style={{ paddingTop: 60 }}>
        <p className="status">Checking access…</p>
      </main>
    );
  }

  if (check.state === 'gated') {
    return (
      <main className="widget" style={{ paddingTop: 60, textAlign: 'center' }}>
        <h1>Your trial has ended</h1>
        <p className="status">
          Get in touch with us to keep using your booking page and dashboard.
        </p>
      </main>
    );
  }

  return (
    <AdminShell slug={slug} tenantName={check.tenantName}>
      {children}
    </AdminShell>
  );
}
