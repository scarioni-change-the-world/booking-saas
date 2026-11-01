/**
 * How much a client is about to be asked, said before they start: on the
 * email step of the booking page, where the first thing asked is the most
 * personal. A service can have one question or ten, or none (then the step
 * is not shown at all), so this is worked out from the real list, never
 * assumed. Times are deliberately round: picking an answer takes a few
 * seconds, writing one takes longer.
 */

export type QuestionKindForEstimate = 'text' | 'yes_no' | 'single_choice';

const SECONDS: Record<QuestionKindForEstimate, number> = { yes_no: 8, single_choice: 12, text: 35 };

/** "3 quick questions · about a minute", or null when there are none. */
export function questionsEstimate(questions: ReadonlyArray<{ kind: QuestionKindForEstimate }>): string | null {
  const n = questions.length;
  if (n === 0) return null;
  const seconds = questions.reduce((sum, q) => sum + (SECONDS[q.kind] ?? 20), 0);
  const minutes = Math.max(1, Math.round(seconds / 60));
  const time = minutes === 1 ? (seconds < 45 ? 'under a minute' : 'about a minute') : `about ${minutes} minutes`;
  const count = n === 1 ? '1 quick question' : n <= 5 ? `${n} quick questions` : `${n} questions`;
  return `${count} · ${time}`;
}

/** The sentence under the heading, true to the number: "a few short" is not ten. */
export function questionsLede(count: number, business: string): string {
  if (count === 1) return `One short question will help ${business} understand what you need.`;
  if (count <= 5) return `A few short questions will help ${business} understand what you need.`;
  return `Some questions will help ${business} understand what you need.`;
}
