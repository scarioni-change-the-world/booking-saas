'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AdminShell from '@/components/admin/AdminShell';
import { adminFetch } from '@/lib/admin-fetch';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { PlanCard, type PlanInfo } from '@/components/admin/BillingCards';

type Check =
  | { state: 'checking' }
  | { state: 'denied' }
  | { state: 'gated'; tenantName?: string; plan?: PlanInfo }
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
  // Back from paying: the webhook that opens the account may land a few
  // seconds after the browser does, so ask again for a little while.
  const [attempt, setAttempt] = useState(0);

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
        const body = (await response.json().catch(() => ({}))) as {
          name: string;
          gated?: boolean;
          plan?: PlanInfo;
        };
        if (!response.ok) throw new Error();
        if (cancelled) return;
        setCheck(
          body.gated
            ? { state: 'gated', tenantName: body.name, plan: body.plan }
            : { state: 'ok', tenantName: body.name },
        );
        if (
          body.gated &&
          attempt < 10 &&
          new URLSearchParams(window.location.search).get('billing') === 'done'
        ) {
          setTimeout(() => !cancelled && setAttempt((n) => n + 1), 3000);
        }
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
  }, [slug, router, attempt]);

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
    const ended =
      check.plan?.state === 'cancelled' ? 'Your subscription has ended' : 'Your trial has ended';
    return (
      <main className="admin-app gated" style={{ padding: '60px 16px' }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          {check.tenantName && <p className="wk-side-eyebrow">{check.tenantName}</p>}
          <h1 style={{ marginTop: 4 }}>{ended}</h1>
          <p className="status" style={{ textAlign: 'left' }}>
            Your booking page is closed to new bookings until you subscribe. Nothing is lost — your
            services, clients and bookings are all here, and open again the moment you do.
          </p>
          {check.plan?.canSubscribe ? (
            <PlanCard slug={slug} plan={check.plan} />
          ) : (
            <p className="status" style={{ textAlign: 'left' }}>
              Get in touch with us to keep using your booking page and dashboard.
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <AdminShell slug={slug} tenantName={check.tenantName}>
      {children}
    </AdminShell>
  );
}
