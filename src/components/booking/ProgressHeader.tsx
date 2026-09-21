'use client';

import { STEP_LABELS, type StepId } from './journey';

/**
 * Where you are, and the way back.
 *
 * Deliberately quiet: a thin rule and one short line, not a numbered stepper
 * across the top. A booking is three to five steps, and a stepper that
 * renders every one of them makes a two-minute task look like an
 * application form.
 *
 * The count comes from the steps this business actually has — see
 * applicableSteps. A client of a one-service business with no questions is
 * told "1 of 4", because that is the truth for them, not "3 of 6" from a
 * journey they were never put through.
 *
 * The label is announced politely rather than assertively: a screen-reader
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
  /* No count on the service step, because at that moment there isn't one to
     give: whether this journey has a questions step depends on which service
     gets picked, and that has not happened yet. Showing "1 of 5" and then
     "3 of 6" two screens later does not read as new information — it reads
     as a form that cannot count. */
  const showCount = current !== 'service';
  const position = steps.indexOf(current) + 1;
  const total = steps.length;
  const fraction = total > 0 ? position / total : 0;

  return (
    <div className="bk-progress">
      <div className="bk-progress-row">
        {canGoBack ? (
          <button type="button" className="bk-back" onClick={onBack}>
            <span aria-hidden="true">←</span> Back
          </button>
        ) : (
          <span />
        )}
        <p className="bk-progress-label" aria-live="polite">
          {showCount && (
            <>
              <span className="bk-progress-count">
                Step {position} of {total}
              </span>
              <span aria-hidden="true"> · </span>
            </>
          )}
          {STEP_LABELS[current]}
        </p>
      </div>

      {/* Presentational: the sentence above already says the same thing, and
          says it to everybody. */}
      <div className="bk-rule" aria-hidden="true">
        <div className="bk-rule-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
    </div>
  );
}
