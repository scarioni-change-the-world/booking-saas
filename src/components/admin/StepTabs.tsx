'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface StepTabDef {
  href: string;
  label: string;
}

/**
 * The Intake builder's 01/02/03 tab bar. A real <Link> per tab, not a
 * client-side-only toggle — each step is its own URL, so it survives a
 * refresh and can be bookmarked or shared, same as every other admin page.
 */
export default function StepTabs({ base, tabs }: { base: string; tabs: StepTabDef[] }) {
  const pathname = usePathname();

  return (
    <nav className="step-tabs" aria-label="Intake setup steps">
      {tabs.map((tab, i) => {
        const href = tab.href ? `${base}/${tab.href}` : base;
        const active = pathname === href;
        return (
          <Link key={href} href={href} className={`step-tab${active ? ' active' : ''}`}>
            <span className="step-tab-num">{String(i + 1).padStart(2, '0')}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
