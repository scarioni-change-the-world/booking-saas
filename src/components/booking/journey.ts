/**
 * Which steps this booking actually has, and what they are called.
 *
 * Kept away from the components on purpose. "Where am I, how many are left,
 * and what does Back mean here" is the one part of a multi-step form that is
 * genuinely easy to get wrong and genuinely easy to test — and it changes
 * per business. A tenant with one service and no questions has a three-step
 * journey; a tenant with four services and a questionnaire has five. A
 * progress indicator that counts steps the client will never see is worse
 * than none at all, because it promises a longer journey than they have.
 */

export type StepId = 'service' | 'questions' | 'time' | 'details' | 'review' | 'confirmed';

/**
 * What the journey is actually doing, which is finer-grained than what the
 * progress rule shows.
 *
 * Two phases share one step on purpose. 'email' and 'questions' both read as
 * "A few questions" because, to the client, they are: being asked for an
 * address so the business can reply either way is the first question, not a
 * separate stage. Splitting them on screen would make a two-question
 * questionnaire look like a three-step form.
 *
 * 'loading' and 'other' map to no step at all. The first has not started;
 * the second is a conclusion, and numbering it would frame a considered
 * recommendation as a stage somebody failed to get past.
 */
export type Phase =
  | 'loading'
  | 'service'
  | 'email'
  | 'questions'
  | 'other'
  | 'time'
  | 'details'
  | 'review'
  | 'confirmed';

/** The step a phase belongs to, or null when it belongs to none. */
export function stepIdFor(phase: Phase): StepId | null {
  switch (phase) {
    case 'service':
      return 'service';
    case 'email':
    case 'questions':
      return 'questions';
    case 'time':
      return 'time';
    case 'details':
      return 'details';
    case 'review':
      return 'review';
    case 'confirmed':
      return 'confirmed';
    default:
      return null;
  }
}

/**
 * The labels a client reads.
 *
 * None of them name the mechanism. "A few questions", never "screening";
 * "Service", never "event type". The vocabulary rule from the brand guide
 * applies hardest here, because this is the one surface a stranger sees.
 */
export const STEP_LABELS: Record<StepId, string> = {
  service: 'Service',
  questions: 'A few questions',
  time: 'Time',
  details: 'Your details',
  review: 'Review',
  confirmed: 'Confirmed',
};

/** What varies between one business's journey and another's. */
export interface JourneyShape {
  /** More than one service to choose from. One service skips the screen. */
  serviceChoice: boolean;
  /** This service asks the client something before opening the calendar. */
  questions: boolean;
}

/** The steps that apply, in order. */
export function applicableSteps(shape: JourneyShape): StepId[] {
  const steps: StepId[] = [];
  if (shape.serviceChoice) steps.push('service');
  if (shape.questions) steps.push('questions');
  steps.push('time', 'details', 'review', 'confirmed');
  return steps;
}

/**
 * Position for the progress rule — 1-based, and 0 for a step that does not
 * apply to this journey (the alternative path, which is a conclusion rather
 * than a stage).
 */
export function stepPosition(steps: readonly StepId[], current: StepId): number {
  return steps.indexOf(current) + 1;
}

/**
 * Where Back goes, or null when there is nowhere to go.
 *
 * Null on the first step, obviously — and null on 'confirmed', which is the
 * one that matters: the booking is made, and a Back button there invites
 * somebody to try to un-make it by navigating, which is not what the button
 * does.
 */
export function previousStep(steps: readonly StepId[], current: StepId): StepId | null {
  if (current === 'confirmed') return null;
  const index = steps.indexOf(current);
  if (index <= 0) return null;
  return steps[index - 1] ?? null;
}

/**
 * "a" or "an", for a number read aloud.
 *
 * Needed because pack sizes are data: "a 8-session package" is what you get
 * from concatenation, and it is the kind of small wrongness that makes a
 * page feel machine-made. English takes "an" before a vowel *sound*, so this
 * turns on how the number is spoken, not how it is spelled — eight, eleven
 * and eighteen, and anything beginning with them.
 */
export function articleFor(n: number): 'a' | 'an' {
  const digits = String(Math.abs(Math.trunc(n)));
  if (digits.startsWith('8')) return 'an';
  if (digits.startsWith('11') || digits.startsWith('18')) return 'an';
  return 'a';
}
