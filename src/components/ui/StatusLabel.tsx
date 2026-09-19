import type { ReactNode } from 'react';

/**
 * What state something is in, said in words a person would use.
 *
 * Two rules this encodes. The labels are human — "Ready to book", not
 * "qualified"; "Resource shared", not "rejected" — because the vocabulary a
 * product uses about people leaks into how its users talk about them, and
 * nobody running a small practice thinks of an enquiry as unqualified.
 *
 * And the tone is carried by a dot and a word together, never by colour
 * alone. A status that reads only as "the green one" is invisible to a
 * reader who cannot tell it from the amber one.
 */

export type StatusTone = 'live' | 'attention' | 'broken' | 'info' | 'neutral';

const TONE_CLASS: Record<StatusTone, string> = {
  live: 'status-label-live',
  attention: 'status-label-attention',
  broken: 'status-label-broken',
  info: 'status-label-info',
  neutral: 'status-label-neutral',
};

export function StatusLabel({
  tone = 'neutral',
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <span className={`status-label ${TONE_CLASS[tone]}`}>
      <span className="status-label-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * A single number worth looking at, with its label under it.
 *
 * Number in Soft Mineral, label in Graphite, thin border, no chart. The
 * brief's warning about multicoloured analytics dashboards is really a
 * warning about decoration standing in for information: four of these in a
 * row is a summary, and anything more elaborate needs to justify itself
 * against real data rather than against how a dashboard is supposed to look.
 */
export function StatBlock({
  value,
  label,
  note,
}: {
  value: ReactNode;
  label: string;
  /** An optional comparison — the one place Muted Ochre is allowed here. */
  note?: ReactNode;
}) {
  return (
    <div className="stat-block">
      <span className="stat-block-value">{value}</span>
      <span className="stat-block-label">{label}</span>
      {note && <span className="stat-block-note">{note}</span>}
    </div>
  );
}

/**
 * What to show when there is nothing yet.
 *
 * One headline, one explanation, one action — the brief's shape exactly.
 * An empty screen is the first thing a new customer sees on most of these
 * pages, so it is the most-read copy in the product and deserves to tell
 * them what to do rather than apologise for having no data.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
