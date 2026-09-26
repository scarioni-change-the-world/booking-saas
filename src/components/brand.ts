import { brandAccent } from '@/lib/brand-colour';

/**
 * Tenant identity helpers, shared by every surface a client sees — never
 * intro's own identity.
 */

/**
 * CSS variable override for a tenant's own colour, or undefined to leave
 * Mineral in place.
 *
 * The business's colour takes Mineral's one job on a client's screen —
 * where you are, and the main key — and nothing else. It is checked here
 * (brand-colour.ts) rather than trusted, so a colour saved before the rule
 * existed, or one that could be mistaken for Ochre, falls back to Mineral.
 * Status colours are fixed in globals.css and never touched here.
 */
export function accentStyle(accentColor?: string | null): React.CSSProperties | undefined {
  const hex = brandAccent(accentColor);
  return hex ? ({ '--accent': hex } as React.CSSProperties) : undefined;
}
