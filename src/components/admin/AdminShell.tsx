'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * The nav list — grouped by how often it gets used, not by topic. Overview,
 * Meetings, Clients, Availability and Intake are the things a tenant checks
 * day to day; Sessions and Settings are set up once and revisited rarely.
 * `divider: true` on Sessions is what makes that grouping visible rather
 * than just a comment here that nobody looking at the sidebar can see — a
 * UX audit of this shell flagged the two being disconnected as a real gap.
 * Same order and same items on desktop and mobile — see the note in
 * globals.css on why mobile doesn't fold anything under a "More" tab.
 *
 * Enquiries sits in the daily group and Questions below the divider, which
 * is the split those two always wanted: watching how the questionnaire is
 * converting is worth checking often, same as Meetings or Clients, while
 * writing the questions is a pure builder nobody opens twice in a week.
 * They were one entry until the reading half outgrew being a tab on the
 * writing half.
 * Sessions stayed below the divider on its own merits: it is a catalogue
 * of what's bookable, genuinely configured once and rarely revisited, like
 * Settings next to it.
 *
 * Labels only, not the URLs: "screening" and "bookings" stay as route
 * segments (nothing bookmarked or linked should break over a rename), but
 * the brand guide's own preferred language — "meeting" over "booking",
 * "intake" over "screening" — is what a tenant actually reads.
 *
 * No per-item icon set any more — a UX pass swapped it for a numbered
 * badge (see navItems below and .admin-nav-badge in globals.css): the
 * icons were decorative wayfinding that didn't match anything else in the
 * app, where a plain number does the same "which item" job and, filled
 * solid on the active one, a stronger "where am I" job than a tinted icon
 * ever did.
 */
/* Labels follow the redesign brief's vocabulary — the words a service
 * professional would use, not the ones the schema happens to use. Routes are
 * untouched; only what the person reads changed.
 *
 *   Meetings -> Bookings   the brief's word for the thing itself
 *   Intake   -> Enquiries  "intake" is a form someone fills in at a clinic
 *
 * Enquiries and Questions are two entries rather than one, and which side of
 * the divider they fall on is the point: writing the questions is something
 * a business finishes, and sits with Services and Settings; reading what
 * came back is something they return to weekly, and sits with the screens
 * they check. Filing the second under the first framed a month of evidence
 * as the last step of a setup wizard.
 *   Sessions -> Services   what a business sells, not what the table is called
 *
 * Two of the brief's suggested destinations are deliberately absent.
 * "Messages" has no page behind it — email templates live inside Settings,
 * and inventing a nav item for a place that does not exist is the one thing
 * the brief tells us not to do.
 *
 * "Week" replaced two entries, Bookings and Availability. They were two
 * screens about the same seven days — when you are open, and what is in it
 * — and neither could show the one thing a business looks for, which is
 * where the week is full and where it is empty. See docs/roadmap.md: this is
 * the first of the three places the app is becoming. */
const NAV = [
  { href: 'overview', label: 'Overview' },
  { href: 'week', label: 'Week' },
  { href: 'clients', label: 'Clients' },
  { href: 'enquiries', label: 'Enquiries' },
  { href: 'sessions', label: 'Services', divider: true },
  { href: 'screening', label: 'Questions' },
  { href: 'settings', label: 'Settings' },
];

interface Props {
  slug: string;
  tenantName: string;
  children: React.ReactNode;
}

export default function AdminShell({ slug, tenantName, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // startsWith, not ===: Intake is now a section with its own sub-routes
  // (screening/next-steps) via a step-tab layout, and
  // the sidebar entry should stay highlighted across all of them. The
  // trailing slash on the prefix keeps "screening" from matching a
  // future "screening-x" segment.
  const isActive = (href: string) => {
    const base = `/admin/${slug}/${href}`;
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push('/admin/login');
  }

  const navItems = (onNavigate?: () => void) =>
    NAV.map((item, index) => (
      <div key={item.href}>
        {item.divider && <div className="admin-nav-divider" role="separator" />}
        <a
          href={`/admin/${slug}/${item.href}`}
          className={`admin-nav-item${isActive(item.href) ? ' active' : ''}`}
          onClick={onNavigate}
        >
          <span className="admin-nav-badge" aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </span>
          {item.label}
        </a>
      </div>
    ));

  return (
    <div className="admin-app">
      <aside className="admin-side">
        <a href={`/admin/${slug}/overview`} className="admin-brand">
          intro
        </a>
        <nav className="admin-nav">{navItems()}</nav>
        <div className="admin-side-foot">
          {tenantName}
          <br />
          <a
            href="#"
            className="btn-link"
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
          <a href={`/admin/${slug}/overview`} className="admin-brand">
            intro
          </a>
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
