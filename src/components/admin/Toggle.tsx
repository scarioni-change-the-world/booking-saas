'use client';

/** The on/off switch used throughout the dashboard — one definition, so every
 * toggle looks and behaves the same rather than three near-identical copies
 * drifting apart across Sessions, Screening and Settings. */
export default function Toggle({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="admin-toggle" onClick={onClick}>
      <span className={`admin-toggle-track${on ? ' on' : ''}`}>
        <span className="admin-toggle-thumb" />
      </span>
      {label}
    </button>
  );
}
