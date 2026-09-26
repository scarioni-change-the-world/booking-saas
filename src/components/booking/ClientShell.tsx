import type { ReactNode } from 'react';
import { accentStyle } from '../brand';
import { Nameplate, type NameplateBranding } from './Nameplate';

export interface ShellBusiness {
  name: string;
  branding?: (NameplateBranding & { accentColor?: string | null }) | null;
}

/**
 * The page every client-facing screen stands on when opened directly: the
 * business's nameplate in a bar across the top, the screen's own content,
 * and intro's credit, once and small, at the foot. The booking page, a
 * booking's manage link, a client's own link and "get your booking link"
 * all use it, so a client moving between them never meets a second product.
 *
 * The embedded booking page does not: framed inside the business's own
 * website, their site is already the nameplate.
 */
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
  return (
    <div className="bk bk-standalone" style={accentStyle(business?.branding?.accentColor)}>
      <header className="bk-masthead">
        {business ? <Nameplate name={business.name} branding={business.branding} /> : <span />}
        {aside && <div className="bk-masthead-aside">{aside}</div>}
      </header>
      <main className="bk-page">{children}</main>
      {/* The only place intro speaks on these pages, and it speaks quietly. */}
      <p className="bk-credit">
        Powered by <span className="bk-wordmark">intro</span>
      </p>
    </div>
  );
}
