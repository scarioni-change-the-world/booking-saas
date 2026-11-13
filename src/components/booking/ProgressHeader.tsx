'use client';

import { STEP_LABELS, type StepId } from './journey';

/** The short names under each segment of the track. */
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
 * "Step 2 of 4" over a track of one segment per step: Ink for a step done,
 * the business's colour for the one you are on, Stone for the ones to come,
 * with each step's name under its segment. It was a row of small rings,
 * which read as radio buttons, things to click, rather than a way through.
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
      {known ? (
        /* A track that fills, not a row of dots: dots read as options to
           click, and this is a way through, one step after another. */
        <div className="bk-journey">
          <p className="bk-journey-count" aria-live="polite">
            Step {position} of {steps.length}
            <span className="sr-only"> · {STEP_LABELS[current]}</span>
          </p>
          <ol className="bk-track" aria-hidden="true">
            {steps.map((step, i) => (
              <li
                key={step}
                className={`bk-track-step${i + 1 < position ? ' is-done' : i + 1 === position ? ' is-here' : ''}`}
              >
                <span className="bk-track-bar" />
                <span className="bk-track-label">{LAMP_LABELS[step]}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="bk-progress-label is-alone" aria-live="polite">
          {STEP_LABELS[current]}
        </p>
      )}
      {canGoBack && (
        <button type="button" className="bk-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </button>
      )}
    </div>
  );
}
