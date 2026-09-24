'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * Three places, and the account.
 *
 * The sidebar listed eight screens, and every one of them answered one of
 * three questions: how does somebody reach me, when am I available, and who
 * has been through. Each question has one place now — Flow, Week, People —
 * and what is left is housekeeping, in Settings. See docs/roadmap.md.
 *
 * Three fit a phone's width as tabs, so the phone gets the same bar the
 * desktop does rather than a menu to open first. Settings and signing out
 * sit at the right, and under a menu button on a phone.
 *
 * The screens Flow grew out of — Services, a service's own settings,
 * Questions, Messages — are still pages, reached from the part of the flow
 * they belong to. While on one, Flow stays the lit place and a way back to
 * it sits above the page, so nobody is somewhere the bar does not explain.
 */
const PLACES = [
  { href: 'flow', label: 'Flow' },
  { href: 'week', label: 'Week' },
  { href: 'people', label: 'People' },
];

/** Routes that are parts of the flow, opened from it. */
const FLOW_PARTS = ['sessions', 'screening', 'messages', 'enquiries', 'overview'];

interface Props {
  slug: string;
  tenantName: string;
  children: React.ReactNode;
}

export default function AdminShell({ slug, tenantName, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // startsWith, not ===: a place has sub-routes, and it should stay lit
  // across all of them. The trailing slash keeps "people" from matching a
  // future "people-x" segment.
  const under = (href: string) => {
    const base = `/admin/${slug}/${href}`;
    return pathname === base || pathname.startsWith(`${base}/`);
  };
  const inFlowPart = FLOW_PARTS.some(under);
  const isActive = (href: string) => under(href) || (href === 'flow' && inFlowPart);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push('/admin/login');
  }

  return (
    <div className="admin-app shell">
      <header className="shell-bar">
        <a href={`/admin/${slug}/flow`} className="admin-brand">
          intro
        </a>
        <nav className="shell-places" aria-label="Places">
          {PLACES.map((item) => (
            <a
              key={item.href}
              href={`/admin/${slug}/${item.href}`}
              className={`shell-place${isActive(item.href) ? ' active' : ''}`}
              aria-current={isActive(item.href) ? 'page' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="shell-account">
          <span className="shell-tenant">{tenantName}</span>
          <a
            href={`/admin/${slug}/settings`}
            className={`shell-link${under('settings') ? ' active' : ''}`}
            aria-current={under('settings') ? 'page' : undefined}
          >
            Settings
          </a>
          <button type="button" className="btn-link shell-link" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        <button
          type="button"
          className="shell-menu-btn"
          aria-label={menuOpen ? 'Close account menu' : 'Open account menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            {menuOpen ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </header>

      {menuOpen && (
        <div className="shell-menu">
          <span className="shell-tenant">{tenantName}</span>
          <a href={`/admin/${slug}/settings`} className="shell-link">
            Settings
          </a>
          <button type="button" className="btn-link shell-link" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      )}

      <main className="admin-main">
        {inFlowPart && (
          <a className="shell-back" href={`/admin/${slug}/flow`}>
            <span aria-hidden="true">←</span> Flow
          </a>
        )}
        {children}
      </main>
    </div>
  );
}
