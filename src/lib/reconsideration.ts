import type { OutcomePathType } from './db/types';

/**
 * Somebody who answered again after being sent elsewhere.
 *
 * The questionnaire is the one thing this product is for: a business decides
 * who is worth meeting, and the answers decide who sees the calendar.
 * Nothing stopped a prospect going back, changing an answer, and walking
 * through the door that had just been closed to them.
 *
 * This surfaces that. It deliberately does not prevent it, and the reasons
 * are worth writing down because "just block it" is the obvious instinct:
 *
 *   - It is trivially defeated. A second email address costs nothing, and a
 *     block would only stop the honest half — the person who mistyped their
 *     budget and went back to fix it.
 *   - Not every second attempt is a lie. Somebody who misread a question, or
 *     whose circumstances genuinely changed between March and June, is
 *     exactly who a business wants to hear from.
 *   - It is not this software's call. The business knows their trade; they
 *     can look at what changed and decide. Silently refusing somebody would
 *     also break the rule the rest of this product keeps — no outcome without
 *     a reason the person can see.
 *
 * So the business is told, shown precisely which answers moved, and left to
 * judge. That is more useful than a block and far more honest than nothing.
 */

export interface AnswerSnapshot {
  questionId: string;
  prompt: string;
  answer: string;
  outcomePathType: OutcomePathType | null;
}

export interface Attempt {
  id: string;
  email: string | null;
  eventTypeId: string | null;
  completedAt: string | null;
  outcomePathType: OutcomePathType | null;
  answers: AnswerSnapshot[];
}

export interface AnswerChange {
  prompt: string;
  before: string;
  after: string;
  /** True when this is the answer that had sent them elsewhere. */
  decisive: boolean;
}

export interface Reconsideration {
  /** When the attempt that was sent elsewhere finished. */
  redirectedAt: string;
  /** Minutes between that attempt and the one that got through. */
  minutesBetween: number;
  /** How many completed attempts came before this one. */
  earlierAttempts: number;
  /** What actually moved. Empty means they answered the same and the
   *  business's own rules changed underneath them — worth knowing too. */
  changed: AnswerChange[];
}

/** Attempts are only comparable when they are the same person answering
 *  about the same service. A different service asks different questions. */
function sameSubject(a: Attempt, b: Attempt): boolean {
  if (!a.email || !b.email) return false;
  if (a.email.toLowerCase() !== b.email.toLowerCase()) return false;
  return a.eventTypeId === b.eventTypeId;
}

/**
 * What changed between two sets of answers.
 *
 * Matched on question id, not on position: a business that adds a question
 * between two attempts would otherwise make every answer below it look
 * changed. A question that only exists in one of the two attempts is left
 * out entirely — it was not answered differently, it was not asked.
 */
function diffAnswers(before: AnswerSnapshot[], after: AnswerSnapshot[]): AnswerChange[] {
  const byId = new Map(before.map((entry) => [entry.questionId, entry]));
  const changes: AnswerChange[] = [];

  for (const now of after) {
    const then = byId.get(now.questionId);
    if (!then) continue;
    if (then.answer.trim() === now.answer.trim()) continue;

    changes.push({
      prompt: now.prompt,
      before: then.answer,
      after: now.answer,
      // The answer that closed the door the first time. Named so the
      // business's eye goes to it rather than to a changed phone number.
      decisive: then.outcomePathType === 'other',
    });
  }

  // The decisive ones first: on a ten-question form they are the only two
  // lines anybody needs to read.
  return changes.sort((a, b) => Number(b.decisive) - Number(a.decisive));
}

/**
 * Was this attempt a second go after being sent elsewhere?
 *
 * Only one shape counts, and the exclusions matter as much as the rule:
 *
 *   redirected, then through  → yes, this is the pattern
 *   redirected, then redirected again → no. They tried again and got the
 *     same answer; nothing was talked around.
 *   through, then through → no. A restart, not a reconsideration.
 *   through, then redirected → no. They made their own case worse, which
 *     is nobody's idea of gaming the gate.
 *
 * `history` may contain the attempt itself; it is ignored by id.
 */
export function findReconsideration(
  attempt: Attempt,
  history: readonly Attempt[],
): Reconsideration | null {
  if (attempt.outcomePathType !== 'meeting' || !attempt.completedAt) return null;

  const earlier = history
    .filter(
      (other) =>
        other.id !== attempt.id &&
        other.completedAt !== null &&
        other.completedAt < attempt.completedAt! &&
        sameSubject(attempt, other),
    )
    .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!));

  const redirected = earlier.filter((other) => other.outcomePathType === 'other');
  if (redirected.length === 0) return null;

  // The last closed door, not the first: what changed since the most recent
  // refusal is what the business is actually looking at.
  const last = redirected[redirected.length - 1]!;

  return {
    redirectedAt: last.completedAt!,
    minutesBetween: Math.max(
      0,
      Math.round(
        (new Date(attempt.completedAt).getTime() - new Date(last.completedAt!).getTime()) / 60_000,
      ),
    ),
    earlierAttempts: earlier.length,
    changed: diffAnswers(last.answers, attempt.answers),
  };
}

/**
 * How to describe the gap, for somebody reading a list.
 *
 * Rounded hard on purpose. "Four minutes later" and "three weeks later" are
 * the two readings that matter, and a business does not need the seconds to
 * tell which one they are looking at.
 */
export function describeGap(minutes: number): string {
  if (minutes < 60) return minutes <= 1 ? 'a minute later' : `${minutes} minutes later`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour later' : `${hours} hours later`;

  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? 'the next day' : `${days} days later`;

  const weeks = Math.round(days / 7);
  if (weeks < 5) return weeks === 1 ? 'a week later' : `${weeks} weeks later`;

  const months = Math.round(days / 30);
  return months === 1 ? 'a month later' : `${months} months later`;
}
