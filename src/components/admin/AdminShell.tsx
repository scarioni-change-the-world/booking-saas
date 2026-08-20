'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

const ICONS: Record<string, string> = {
  overview: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  bookings: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clients:
    '<circle cx="9" cy="8" r="3.4"/><path d="M2.6 20a6.6 6.6 0 0 1 12.8 0M17 11.5a3 3 0 1 0-1.8-5.4M18 20a5.6 5.6 0 0 0-1.4-3.6"/>',
  availability: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  sessions:
    '<path d="M12 3 3 7.5 12 12l9-4.5L12 3Z"/><path d="m3 16.5 9 4.5 9-4.5M3 12l9 4.5L21 12"/>',
  screening:
    '<path d="M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17.5" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/>',
  settings:
    '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.4"/>',
};

/**
 * The nav list — grouped by how often it gets used, not by topic. Overview,
 * Bookings, Clients and Availability are the things a tenant checks day to
 * day; Sessions, Screening and Settings are set up once and revisited
 * rarely. Same order and same items on desktop and mobile — see the note in
 * globals.css on why mobile doesn't fold anything under a "More" tab.
 */
const NAV = [
  { href: 'overview', label: 'Overview' },
  { href: 'bookings', label: 'Bookings' },
  { href: 'clients', label: 'Clients' },
  { href: 'availability', label: 'Availability' },
  { href: 'sessions', label: 'Sessions' },
  { href: 'screening', label: 'Screening' },
  { href: 'settings', label: 'Settings' },
];

function NavIcon({ name }: { name: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? '' }}
    />
  );
}

interface Props {
  slug: string;
  tenantName: string;
  children: React.ReactNode;
}

export default function AdminShell({ slug, tenantName, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isActive = (href: string) => pathname === `/admin/${slug}/${href}`;

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push('/admin/login');
  }

  const navItems = (onNavigate?: () => void) =>
    NAV.map((item) => (
      <a
        key={item.href}
        href={`/admin/${slug}/${item.href}`}
        className={`admin-nav-item${isActive(item.href) ? ' active' : ''}`}
        onClick={onNavigate}
      >
        <NavIcon name={item.href} />
        {item.label}
      </a>
    ));

  return (
    <div className="admin-app">
      <aside className="admin-side">
        <div className="admin-brand">Cerca</div>
        <nav className="admin-nav">{navItems()}</nav>
        <div className="admin-side-foot">
          {tenantName}
          <br />
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void signOut();
            }}
          >
            Sign out
          </a>
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="admin-topbar">
          <div className="admin-brand">Cerca</div>
          <button
            type="button"
            className="admin-menu-btn"
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>

        <nav className={`admin-mobile-nav${mobileNavOpen ? ' open' : ''}`}>
          {navItems(() => setMobileNavOpen(false))}
          <a
            href="#"
            className="admin-nav-item"
            onClick={(e) => {
              e.preventDefault();
              void signOut();
            }}
          >
            Sign out
          </a>
        </nav>

        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
