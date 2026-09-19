import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

/**
 * A labelled field, with its description and its error attached to it.
 *
 * The wiring is the reason this is a component. A visible label tied by
 * htmlFor, a description the field points at with aria-describedby, and an
 * error announced by role="alert" and marked with aria-invalid are four
 * things every field needs and every hand-written field forgets at least
 * one of. Generating the id here means they cannot drift apart.
 *
 * Error text sits directly under the field it belongs to rather than in a
 * summary at the top, so the person reading it is already looking at the
 * thing they need to change.
 */

interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** One line on what this changes — for the professional, or for their client. */
  description?: ReactNode;
  error?: string | null;
  /** Renders a textarea instead of an input. */
  multiline?: boolean;
  rows?: number;
}

export function FormField({
  label,
  description,
  error,
  multiline = false,
  rows = 4,
  className = '',
  ...rest
}: FormFieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  const shared = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? (true as const) : undefined,
    className: `${error ? 'field-input-error' : ''} ${className}`.trim() || undefined,
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {description && (
        <p className="field-description" id={descriptionId}>
          {description}
        </p>
      )}
      {multiline ? (
        <textarea
          rows={rows}
          {...shared}
          {...(rest as unknown as InputHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input {...shared} {...rest} />
      )}
      {error && (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One answer someone can choose, styled as the marketing site's live demo
 * styles its own.
 *
 * A real radio or checkbox underneath, never a div listening for clicks —
 * keyboard operation, screen-reader semantics and the browser's own group
 * behaviour all come free that way, and rebuilding them by hand is how
 * choice controls end up unusable without a mouse.
 *
 * Selection is carried by border, background *and* the control's own mark,
 * so it never rests on colour alone.
 */
interface ChoiceCardProps {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
  /** Radio for one-of, checkbox for several. */
  multiple?: boolean;
  /** A second line under the label — what choosing this means. */
  hint?: ReactNode;
  disabled?: boolean;
}

export function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  children,
  multiple = false,
  hint,
  disabled = false,
}: ChoiceCardProps) {
  return (
    <label className={`choice-card${checked ? ' selected' : ''}${disabled ? ' disabled' : ''}`}>
      <input
        type={multiple ? 'checkbox' : 'radio'}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span className="choice-card-body">
        <span className="choice-card-label">{children}</span>
        {hint && <span className="choice-card-hint">{hint}</span>}
      </span>
    </label>
  );
}
