"use client";

import { useState } from "react";
import { AskKhloe } from "./AskKhloe";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ServiceMarksProvider } from "@/components/admin/ServiceMarks";

/**
 * Four places, said as the owner's: Your services, Your calendar, Your
 * customers, Your business. The first three are the everyday work; the
 * fourth gathers what is set once or looked at now and then (the business's
 * settings, its booking page and sharing, its messages, its reports) under
 * one name, with a pill switch between them. Seven places became four.
 *
 * Opening hours are the business's, in Your business; Your calendar holds
 * only the exceptions (days off, a different day, notice, the connected
 * calendar).
 */
const PLACES = [
  { href: "flow", label: "Your services" },
  { href: "week", label: "Your calendar" },
  { href: "people", label: "Your customers" },
  { href: "account", label: "Your business" },
];

/** The parts of Your business, in the order of its switch. */
export const BUSINESS_PARTS = [
  { href: "account", label: "Settings" },
  { href: "share", label: "Share" },
  { href: "messages", label: "Messages" },
  { href: "reports", label: "Reports" },
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
  const businessPart = BUSINESS_PARTS.find((p) => under(p.href)) ?? null;
  const isActive = (href: string) =>
    under(href) || (href === "flow" && inFlowPart) || (href === "account" && !!businessPart);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push("/");
  }

  return (
    <ServiceMarksProvider slug={slug}>
      <div className="admin-app shell">
        <header className="shell-bar">
          <a href={`/admin/${slug}/flow`} className="admin-brand">
            khloe
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
            aria-label={menuOpen ? "Close menu" : "Open menu"}
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
              <span aria-hidden="true">←</span> Back to your services
            </a>
          )}
          {/* Your business: its four parts, one pill switch above each. */}
          {businessPart && (
            <nav className="wk-mode biz-tabs" aria-label="Your business">
              {BUSINESS_PARTS.map((p) => (
                <a
                  key={p.href}
                  href={`/admin/${slug}/${p.href}`}
                  className="filter-chip"
                  aria-pressed={p === businessPart}
                  aria-current={p === businessPart ? "page" : undefined}
                >
                  {p.label}
                </a>
              ))}
            </nav>
          )}
          {children}
        </main>
      </div>
      {/* On every admin page: ask how, ask why, or say what to change. */}
      <AskKhloe slug={slug} />
    </ServiceMarksProvider>
  );
}
