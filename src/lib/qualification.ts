/**
 * The qualification gate (brief 1, 2.2).
 *
 * Prospects answer screening questions before they are allowed to see the
 * calendar, and an answer can disqualify them. This is the product's actual
 * differentiator, so the rule is kept small, pure and directly testable.
 */

export type QuestionKind = 'text' | 'yes_no' | 'single_choice';

export interface QuestionOption {
  label: string;
  /** false on any chosen option disqualifies the whole response. */
  qualifies: boolean;
}

export interface Question {
  id: string;
  prompt: string;
  kind: QuestionKind;
  options: QuestionOption[];
  required: boolean;
  sortOrder: number;
}

/** Raw answers as submitted: question id -> chosen label or free text. */
export type AnswerMap = Record<string, string>;

export type Outcome = 'qualified' | 'redirected';

export interface AnsweredQuestion {
  questionId: string;
  prompt: string;
  kind: QuestionKind;
  answer: string;
  /** null for free text, which never disqualifies on its own. */
  qualifies: boolean | null;
}

export interface QualificationResult {
  outcome: Outcome;
  answers: AnsweredQuestion[];
}

export class QualificationError extends Error {
  constructor(
    message: string,
    readonly questionId: string,
  ) {
    super(message);
    this.name = 'QualificationError';
  }
}

/**
 * Score a submitted set of answers.
 *
 * Free text is recorded but never gates — there is no reliable way to judge it,
 * and the reference implementation never tried. Only a chosen option carrying
 * `qualifies: false` closes the gate.
 *
 * @throws QualificationError when a required question is unanswered, or an
 * answer names an option the question does not offer. Both are rejected rather
 * than treated as a disqualification: a malformed submission is a bug or a
 * tampering attempt, not a prospect who cannot afford the service, and quietly
 * folding one into the other would make the funnel numbers lie.
 */
export function evaluateQualification(
  questions: readonly Question[],
  submitted: AnswerMap,
): QualificationResult {
  const answers: AnsweredQuestion[] = [];
  let disqualified = false;

  const ordered = [...questions].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const question of ordered) {
    const raw = submitted[question.id];
    const answer = typeof raw === 'string' ? raw.trim() : '';

    if (answer === '') {
      if (question.required) {
        throw new QualificationError(`Missing answer for "${question.prompt}"`, question.id);
      }
      continue;
    }

    if (question.kind === 'text') {
      answers.push({
        questionId: question.id,
        prompt: question.prompt,
        kind: question.kind,
        answer,
        qualifies: null,
      });
      continue;
    }

    const option = question.options.find((o) => o.label === answer);
    if (!option) {
      throw new QualificationError(
        `"${answer}" is not an option for "${question.prompt}"`,
        question.id,
      );
    }

    if (!option.qualifies) disqualified = true;

    answers.push({
      questionId: question.id,
      prompt: question.prompt,
      kind: question.kind,
      answer,
      qualifies: option.qualifies,
    });
  }

  return { outcome: disqualified ? 'redirected' : 'qualified', answers };
}

/**
 * Strip the `qualifies` flags before sending questions to the browser.
 *
 * The widget renders every question on one page (brief 2.2), so the whole set
 * is in the client's hands. Shipping the flags with it would publish exactly
 * which answers open the calendar, and the gate would be trivially walked past.
 * Scoring happens server-side against the unstripped rows.
 */
export function toPublicQuestions(questions: readonly Question[]) {
  return [...questions]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((q) => ({
      id: q.id,
      prompt: q.prompt,
      kind: q.kind,
      required: q.required,
      options: q.options.map((o) => o.label),
    }));
}
