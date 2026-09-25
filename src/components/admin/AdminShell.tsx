"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ServiceMarksProvider } from "@/components/admin/ServiceMarks";

/**
 * Three places, and the account.
 *
 * The sidebar listed eight screens, and every one of them answered one of
 * three questions: how does somebody reach me, when am I available, and who
 * has been through. Each question has one place now — Services (the Flow
 * screen), Week, People — and what is left is housekeeping, in Account.
 * See docs/roadmap.md. The first is labelled "Services", not "Flow": it is
 * what somebody looking for their services clicks, and its page is titled
 * "Your services", so the bar and the page say the same word.
 *
 * Messages — every email a client gets, and the words on the page — is a
 * place of its own too: reached only through Flow, it was the screen people
 * could not find when they wanted to change a confirmation email.
 *
 * Four still fit a phone's width as tabs, so the phone gets the same bar
 * the desktop does rather than a menu to open first. Account and signing
 * out sit at the right, and under a menu button on a phone.
 *
 * A service's own settings and Questions are still pages of their own,
 * reached from the part of a service's flow they belong to. While on one,
 * Services stays the lit place and a way back to it sits above the page,
 * so nobody is somewhere the bar does not explain.
 */
const PLACES = [
  { href: "flow", label: "Services" },
  { href: "week", label: "Week" },
  { href: "people", label: "People" },
  { href: "messages", label: "Messages" },
];

/** Routes that are parts of the flow, opened from it. */
const FLOW_PARTS = ["sessions", "screening", "enquiries", "overview"];

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
  const isActive = (href: string) =>
    under(href) || (href === "flow" && inFlowPart);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push("/admin/login");
  }

  return (
    <ServiceMarksProvider slug={slug}>
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
                className={`shell-place${isActive(item.href) ? " active" : ""}`}
                aria-current={isActive(item.href) ? "page" : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="shell-account">
            <span className="shell-tenant">{tenantName}</span>
            <a
              href={`/admin/${slug}/account`}
              className={`shell-link${under("account") ? " active" : ""}`}
              aria-current={under("account") ? "page" : undefined}
            >
              Account
            </a>
            <button
              type="button"
              className="btn-link shell-link"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
          <button
            type="button"
            className="shell-menu-btn"
            aria-label={menuOpen ? "Close account menu" : "Open account menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              {menuOpen ? (
                <path d="M18 6 6 18M6 6l12 12" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </header>

        {menuOpen && (
          <div className="shell-menu">
            <span className="shell-tenant">{tenantName}</span>
            <a href={`/admin/${slug}/account`} className="shell-link">
              Account
            </a>
            <button
              type="button"
              className="btn-link shell-link"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        )}

        <main className="admin-main">
          {/* A button, not a quiet link: these pages are opened from the
            flow, and the way back has to be the first thing seen here —
            the first version, in small grey type, was missed. */}
          {inFlowPart && (
            <a className="shell-back" href={`/admin/${slug}/flow`}>
              <span aria-hidden="true">←</span> Back to Services
            </a>
          )}
          {children}
        </main>
      </div>
    </ServiceMarksProvider>
  );
}
