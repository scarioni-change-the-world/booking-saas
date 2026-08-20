'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetchJson } from '@/lib/admin-fetch';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Check = { state: 'checking' } | { state: 'denied' } | { state: 'ok'; tenantName: string };

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
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) {
        router.replace('/admin/login');
        return;
      }

      try {
        const me = await adminFetchJson<{ name: string }>(`/api/admin/${slug}/me`);
        if (!cancelled) setCheck({ state: 'ok', tenantName: me.name });
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

  if (check.state === 'checking' || check.state === 'denied') {
    return (
      <main className="widget" style={{ paddingTop: 60 }}>
        <p className="status">Checking access…</p>
      </main>
    );
  }

  return (
    <AdminShell slug={slug} tenantName={check.tenantName}>
      {children}
    </AdminShell>
  );
}
