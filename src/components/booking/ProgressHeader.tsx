'use client';

import { STEP_LABELS, type StepId } from './journey';

/** The short names beside each lamp. */
const LAMP_LABELS: Record<StepId, string> = {
  service: 'Service',
  questions: 'Questions',
  time: 'Time',
  details: 'Details',
  review: 'Review',
  confirmed: 'Booked',
};

/**
 * Where you are, and the way back.
 *
 * One small lamp per step, the way the admin shows a state: dark for a step
 * done, lit in the business's colour for the one you are on, a ring for the
 * ones to come. Names beside them on a wide screen; on a phone the lamps
 * alone and one line of words.
 *
 * The count comes from the steps this business actually has — see
 * applicableSteps. A client of a one-service business with no questions is
 * told "1 of 4", because that is the truth for them.
 *
 * The words are announced politely rather than assertively: a screen-reader
 * user moving between steps should hear where they landed, after whatever
 * they were reading finishes, not be interrupted by it.
 */
export function ProgressHeader({
  steps,
  current,
  canGoBack,
  onBack,
}: {
  steps: readonly StepId[];
  current: StepId;
  canGoBack: boolean;
  onBack: () => void;
}) {
  /* No lamps and no count on the service step, because at that moment there
     aren't any to give: whether this journey has a questions step depends on
     which service gets picked. Lamps that change number two screens later
     read as a form that cannot count. */
  const known = current !== 'service';
  const position = steps.indexOf(current) + 1;

  return (
    <div className="bk-progress">
      {known && (
        <ol className="bk-lamps" aria-hidden="true">
          {steps.map((step, i) => (
            <li
              key={step}
              className={`bk-lamp-step${i + 1 < position ? ' is-done' : i + 1 === position ? ' is-here' : ''}`}
            >
              <span className="bk-lamp" />
              <span className="bk-lamp-label">{LAMP_LABELS[step]}</span>
            </li>
          ))}
        </ol>
      )}
      <p className={`bk-progress-label${known ? '' : ' is-alone'}`} aria-live="polite">
        {known && `Step ${position} of ${steps.length} · `}
        {STEP_LABELS[current]}
      </p>
      {canGoBack && (
        <button type="button" className="bk-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </button>
      )}
    </div>
  );
}
