import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * The three weights of action, and nothing between them.
 *
 * Having these as components rather than as remembered class names is the
 * point: every screen reaching for the same three decides consistently, and
 * the day a button's spec changes it changes once. The classes underneath
 * (.btn-primary, .btn-secondary, .btn-link) are unchanged, so a page that
 * has not been converted yet still looks identical to one that has.
 *
 * Only one primary action per view. If a screen seems to want two, one of
 * them is secondary — the brief's "guide attention in one direction".
 */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode };

export function PrimaryButton({ children, className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={`btn-primary ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={`btn-secondary ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}

/**
 * A destructive action, kept deliberately away from the other two.
 *
 * Renders as a text action rather than a filled button, because a filled
 * red slab beside a filled Mineral one turns "delete" into a peer of "save"
 * — and the brief is explicit that Error red is reserved for genuine errors
 * and destructive actions, which means it has to stay rare enough to still
 * mean something when it appears.
 */
export function DestructiveAction({ children, className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={`btn-destructive ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}

type TextLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  /** A trailing arrow, for a link that moves you somewhere rather than explaining something. */
  forward?: boolean;
};

export function TextLink({ children, forward = false, className = '', ...rest }: TextLinkProps) {
  return (
    <a className={`text-action ${className}`.trim()} {...rest}>
      {children}
      {forward && (
        <span aria-hidden="true" className="text-action-arrow">
          →
        </span>
      )}
    </a>
  );
}
