import type { ReactNode } from 'react';

/**
 * Page and section identity.
 *
 * PageHeader is also what this app has instead of a separate top bar. The
 * brief asks for one carrying page identity and contextual actions, and
 * this carries both — adding a second horizontal band above it would mean
 * either repeating the page title or splitting a screen's actions across
 * two rows, and neither earns the vertical space. Account access lives in
 * the sidebar's foot, which is on every screen already.
 *
 * Sizes follow the brief's application scale, not the marketing site's:
 * a page title here is 32-40px, where a landing headline is 72px. The same
 * typeface, deliberately not the same voice.
 */

interface PageHeaderProps {
  /** Short uppercase line above the title — which section of the product this is. */
  eyebrow?: string;
  title: string;
  /** One sentence on what this screen is for. Optional, and usually worth it. */
  description?: ReactNode;
  /** Contextual actions for the whole page, right-aligned on desktop. */
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-identity">
        {eyebrow && <p className="admin-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-header-description">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

interface SectionHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Renders as h3 rather than h2 where the section sits inside another. */
  nested?: boolean;
}

export function SectionHeader({ title, description, actions, nested = false }: SectionHeaderProps) {
  const Heading = nested ? 'h3' : 'h2';
  return (
    <div className="section-header">
      <div>
        <Heading className="section-header-title">{title}</Heading>
        {description && <p className="section-header-description">{description}</p>}
      </div>
      {actions && <div className="section-header-actions">{actions}</div>}
    </div>
  );
}

/**
 * A primary product surface: the panel a screen is about.
 *
 * Deliberately not the default container. The brief's instruction — use
 * borders, rows, dividers and whitespace before adding another container —
 * is the thing most likely to be lost as screens get built, so this is one
 * component rather than a class anyone can sprinkle.
 */
export function Surface({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  /** Off when the surface holds full-bleed rows that draw their own padding. */
  padded?: boolean;
}) {
  return (
    <section className={`surface ${padded ? '' : 'surface-flush'} ${className}`.trim()}>
      {children}
    </section>
  );
}
