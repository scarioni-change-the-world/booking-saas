import type { ReactNode } from 'react';

/**
 * A row in a list of things.
 *
 * This exists because of a specific failure the screening page showed:
 * every question was a bordered card whose height was set by a vertical
 * stack of three actions on the right, so a one-line question produced a
 * mostly-empty box, and ten questions produced a long scroll of them.
 *
 * A row is not a card. It has a divider rather than a border, it is as tall
 * as its content, and its actions sit inline. The brief's rule — borders,
 * rows, dividers and whitespace before another container — is what this
 * makes easy to follow and hard to forget.
 *
 * Put rows inside a <Surface padded={false}>, which draws the panel around
 * them and lets each row own its own padding.
 */

interface DataRowProps {
  /** Usually a circular initials mark or a small outline icon. */
  lead?: ReactNode;
  title: ReactNode;
  /** Service name, answer type, whatever qualifies the title. Graphite. */
  meta?: ReactNode;
  /** A status, count or timestamp, aligned consistently down the right edge. */
  trailing?: ReactNode;
  /** Inline actions. Kept beside the content, never stacked below it. */
  actions?: ReactNode;
  /** Reordering handles and the like, before the lead. */
  handle?: ReactNode;
}

export function DataRow({ lead, title, meta, trailing, actions, handle }: DataRowProps) {
  return (
    <div className="data-row">
      {handle && <div className="data-row-handle">{handle}</div>}
      {lead && <div className="data-row-lead">{lead}</div>}
      <div className="data-row-body">
        <span className="data-row-title">{title}</span>
        {meta && <span className="data-row-meta">{meta}</span>}
      </div>
      {trailing && <div className="data-row-trailing">{trailing}</div>}
      {actions && <div className="data-row-actions">{actions}</div>}
    </div>
  );
}

/**
 * The circular initials mark beside a client's name.
 *
 * Initials rather than an avatar because this product has no photographs of
 * anyone and inventing placeholder faces would be worse than a letter.
 */
export function InitialsMark({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

  return (
    <span className="initials-mark" aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

/**
 * A question and its answer, read as a pair.
 *
 * Question small and Graphite, answer in Ink and heavier — so someone
 * scanning a response vertically reads the answers and only drops to the
 * questions when one surprises them.
 */
export function AnswerPair({ question, answer }: { question: ReactNode; answer: ReactNode }) {
  return (
    <div className="answer-pair">
      <p className="answer-pair-question">{question}</p>
      <p className="answer-pair-answer">{answer}</p>
    </div>
  );
}
