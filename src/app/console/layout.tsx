'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import { supabaseBrowser } from '@/lib/supabase-browser';
import type { PlatformRole } from '@/lib/db/types';

type Check = { state: 'checking' } | { state: 'denied' } | { state: 'ok'; role: PlatformRole };

/**
 * The gate every console page sits behind — the same shape as the admin
 * dashboard's own gate (src/app/admin/[slug]/layout.tsx), checking
 * platform_staff instead of one tenant's membership. Same trade-off noted
 * there applies here too: no server-side session, so this is a client-side
 * check after the page has already started rendering.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [check, setCheck] = useState<Check>({ state: 'checking' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) {
        router.replace('/console/login');
        return;
      }

      try {
        const me = await adminFetchJson<{ role: PlatformRole }>('/api/console/me');
        if (!cancelled) setCheck({ state: 'ok', role: me.role });
      } catch {
        if (!cancelled) {
          setCheck({ state: 'denied' });
          router.replace('/console/login');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push('/console/login');
  }

  if (check.state === 'checking' || check.state === 'denied') {
    return (
      <main className="widget" style={{ paddingTop: 60 }}>
        <p className="status">Checking access…</p>
      </main>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 20px 60px' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 28,
        }}
      >
        <span className="admin-brand" style={{ fontSize: 22 }}>
          Cerca <span style={{ color: 'var(--muted)', fontSize: '0.6em' }}>console</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--faint)', textTransform: 'capitalize' }}>
            {check.role}
          </span>
          <button type="button" className="btn-link" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
