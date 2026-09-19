'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { adminFetchJson } from '@/lib/admin-fetch';
import { supabaseBrowser } from '@/lib/supabase-browser';
import type { PlatformRole } from '@/lib/db/types';

type Check =
  | { state: 'checking' }
  | { state: 'denied' }
  | { state: 'misconfigured'; detail: string }
  | { state: 'ok'; role: PlatformRole };

/**
 * The gate every console page sits behind — the same shape as the admin
 * dashboard's own gate (src/app/admin/[slug]/layout.tsx), checking
 * platform_staff instead of one tenant's membership. Same trade-off noted
 * there applies here too: no server-side session, so this is a client-side
 * check after the page has already started rendering.
 *
 * /console/login is itself a route under this layout (Next.js nests by
 * directory), so it has to be excluded from the gate explicitly — otherwise
 * a signed-out visitor lands on the login page, the gate finds no session,
 * and redirects to... the login page it's already on. Caught by actually
 * loading the page rather than assuming the routing worked.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [check, setCheck] = useState<Check>({ state: 'checking' });

  const isLoginPage = pathname === '/console/login';

  useEffect(() => {
    if (isLoginPage) return;
    let cancelled = false;

    (async () => {
      // supabaseBrowser() throws outright when the NEXT_PUBLIC_ variables
      // are missing from the bundle — which is what happens when they were
      // added to the host after the build, since Next inlines them at build
      // time rather than reading them at runtime. That throw used to escape
      // this effect entirely: nothing set state, so the page sat on
      // "Checking access…" for ever with no clue why. Fail loud instead.
      let session;
      try {
        ({ data: session } = await supabaseBrowser().auth.getSession());
      } catch (cause) {
        setCheck({ state: 'misconfigured', detail: (cause as Error).message });
        return;
      }

      if (!session.session) {
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
  }, [isLoginPage, router]);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push('/console/login');
  }

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (check.state === 'misconfigured') {
    return (
      <main className="widget" style={{ paddingTop: 60 }}>
        <h1>Not configured</h1>
        <p className="notice notice-error" role="alert">
          {check.detail}
        </p>
        <p className="tz">
          On Vercel, the <code>NEXT_PUBLIC_</code> variables are baked into the
          build, so adding them is not enough on its own — redeploy afterwards
          so a new build picks them up. <a href="/api/health">/api/health</a>{' '}
          reports which parts are configured.
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
          intro <span style={{ color: 'var(--muted)', fontSize: '0.6em' }}>console</span>
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
