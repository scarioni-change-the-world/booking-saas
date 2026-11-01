import type { ReactNode } from 'react';
import { accentStyle } from '../brand';
import { Nameplate, type NameplateBranding } from './Nameplate';
import { normaliseWebsite, websiteLabel } from '@/lib/website';

export interface ShellBusiness {
  name: string;
  branding?: (NameplateBranding & { accentColor?: string | null; websiteUrl?: string | null }) | null;
}

/**
 * The page every client-facing screen stands on when opened directly: the
 * business's nameplate in a bar across the top, the screen's own content,
 * and khloe's credit, once and small, at the foot. The booking page, a
 * booking's manage link, a client's own link and "get your booking link"
 * all use it, so a client moving between them never meets a second product.
 *
 * The embedded booking page does not: framed inside the business's own
 * website, their site is already the nameplate.
 */
/** The business's own site, re-checked here rather than trusted: it becomes a link. */
function backTo(business: ShellBusiness | null): string | null {
  const site = normaliseWebsite(business?.branding?.websiteUrl);
  return site.ok ? site.url : null;
}

export function ClientShell({
  business,
  aside,
  children,
}: {
  business: ShellBusiness | null;
  /** Quiet text at the bar's right — the returning-client door. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const website = backTo(business);
  return (
    <div className="bk bk-standalone" style={accentStyle(business?.branding?.accentColor)}>
      <header className="bk-masthead">
        {business ? <Nameplate name={business.name} branding={business.branding} /> : <span />}
        {/* Clients usually arrive from the business's own website: the way back. */}
        {website && (
          <a className="bk-masthead-back" href={website}>
            ← Back to {websiteLabel(website)}
          </a>
        )}
        {aside && <div className="bk-masthead-aside">{aside}</div>}
      </header>
      <main className="bk-page">{children}</main>
      {/* The only place khloe speaks on these pages, and it speaks quietly. */}
      <p className="bk-credit">
        Powered by <span className="bk-wordmark">khloe</span>
      </p>
    </div>
  );
}
