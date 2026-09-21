'use client';

import { useState } from 'react';

/**
 * A password input with a reveal control.
 *
 * Its own component because the reset screen needs two of them and the
 * sign-in screen one, and because the two details that make it correct are
 * both easy to lose in a copy: `type="button"`, without which a click
 * inside a form submits it — revealing your password would try to sign you
 * in — and the wrapper, without which the control is positioned against the
 * whole field and lands level with the label instead of inside the box.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="field signin-password">
      <label htmlFor={id}>{label}</label>
      <div className="signin-password__control">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          aria-describedby={hintId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="signin-reveal"
          onClick={() => setShown((was) => !was)}
          aria-pressed={shown}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && (
        <p className="signin-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
