/**
 * The business's nameplate: the one place a client page carries the
 * business's own identity. Their logo if they have one, their name beside it
 * if they asked for that, and their name alone if there is no logo.
 *
 * The name is set in the heading face, never as intro's wordmark — that would
 * be this product wearing its customer's identity.
 */
export interface NameplateBranding {
  logoUrl?: string | null;
  nameBesideLogo?: boolean;
}

export function Nameplate({ name, branding }: { name: string; branding?: NameplateBranding | null }) {
  const logo = branding?.logoUrl || null;
  const showName = !logo || !!branding?.nameBesideLogo;
  return (
    <div className="bk-nameplate">
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element -- the business's own file, any size
        <img className="bk-logo" src={logo} alt={showName ? '' : name} />
      )}
      {showName && <span className="bk-nameplate-name">{name}</span>}
    </div>
  );
}
