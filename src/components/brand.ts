/**
 * Tenant identity helpers, shared by every surface a client sees
 * (BookingFlow, ManageBooking) — never Cerca's own identity.
 */

/** Two-letter initials for a tenant with no logo: "Amelia Rivera" → "AR". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join('') || '?';
}

/**
 * CSS variable override for a tenant's chosen accent, or undefined to leave
 * the default in place.
 *
 * This is the only branding value that ever crosses into --accent. Status
 * colour (--status-live and friends) is fixed in globals.css and is never
 * touched here — see the note at the top of that file.
 */
export function accentStyle(accentColor?: string): React.CSSProperties | undefined {
  return accentColor ? ({ '--accent': accentColor } as React.CSSProperties) : undefined;
}
