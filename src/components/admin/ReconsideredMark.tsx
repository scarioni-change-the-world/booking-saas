'use client';

import { describeGap } from '@/lib/reconsideration';
import type { Reconsideration } from '@/lib/reconsideration';

/**
 * Somebody answered again after being sent elsewhere — said plainly, with
 * the answers that moved.
 *
 * Tone is the whole design here. This is not an accusation: a person who
 * misread a question, or whose budget genuinely changed between March and
 * June, looks identical in the data to somebody working out what to say.
 * The software cannot tell those apart and should not pretend to, so it
 * reports what happened, shows what changed, and stops. The business knows
 * their trade.
 *
 * Which is why the marker is Ochre rather than red. Red would be a verdict.
 * This is a thing worth a second look.
 */
export function ReconsideredMark({ reconsidered }: { reconsidered: Reconsideration }) {
  const { changed, minutesBetween, earlierAttempts } = reconsidered;

  return (
    <details className="reconsidered">
      <summary>
        <span className="reconsidered-mark">Answered again</span>
        <span className="reconsidered-gap">
          {describeGap(minutesBetween)}
          {earlierAttempts > 1 && ` · ${earlierAttempts} earlier attempts`}
        </span>
      </summary>

      <div className="reconsidered-body">
        {changed.length === 0 ? (
          /* The same answers, a different outcome. Nobody changed anything —
             the business's own rules moved between the two attempts, and
             saying so stops this reading as suspicion of the client. */
          <p className="reconsidered-note">
            They gave the same answers both times. Your questions or rules
            changed between the two attempts.
          </p>
        ) : (
          <>
            <p className="reconsidered-note">
              This is what they answered differently the second time.
            </p>
            <ul className="reconsidered-changes">
              {changed.map((change) => (
                <li key={change.prompt} data-decisive={change.decisive ? 'true' : undefined}>
                  <p className="reconsidered-prompt">{change.prompt}</p>
                  <p className="reconsidered-values">
                    <span className="reconsidered-before">{change.before}</span>
                    <span aria-hidden="true"> → </span>
                    <span className="reconsidered-after">{change.after}</span>
                  </p>
                  {/* Named, not just coloured: this is the answer that had
                      sent them elsewhere, and on a ten-question form it is
                      the only line anybody needs. */}
                  {change.decisive && (
                    <p className="reconsidered-why">
                      This is the answer that sent them elsewhere the first time.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}
