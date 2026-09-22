import type { OutcomePathType } from './db/types';
import type { AnswerSnapshot } from './reconsideration';

/**
 * Reading a month of enquiries as evidence rather than as a list.
 *
 * The questions a business is actually asking are not "who enquired" — they
 * are "why is this question sending so many people away" and "why is this
 * service not converting". Both are answerable from what is already stored,
 * and neither is answerable by scrolling.
 *
 * Everything here is pure. The rows come from one query; the judgements come
 * from these functions, where they can be tested without a database.
 */

export interface AnalysedResponse {
  eventTypeId: string | null;
  completedAt: string | null;
  outcomePathType: OutcomePathType | null;
  answers: AnswerSnapshot[];
}

export interface QuestionInsight {
  questionId: string;
  prompt: string;
  /** Completed responses that answered this question. */
  answered: number;
  /** Of those, how many gave an answer that pointed away from the calendar. */
  sentElsewhere: number;
  /** Which answers do the sending, commonest first. */
  routingAnswers: Array<{ answer: string; count: number }>;
}

export interface ServiceInsight {
  eventTypeId: string | null;
  started: number;
  completed: number;
  meeting: number;
  other: number;
}

/**
 * Which questions are doing the filtering.
 *
 * Counted per *answer*, not per response, and the difference matters: one
 * person can be sent away by two questions at once, so these numbers overlap
 * and must not be added up. What each row says is "of the people who reached
 * this question, this many gave an answer that closed the calendar" — which
 * is the number a business can act on, because the action is to change that
 * question or that answer's rule.
 *
 * The commonest routing answer is carried alongside, because "20 of 34 were
 * sent away here" is a finding and "and 18 of them said Under €1,000" is a
 * decision.
 *
 * Only completed responses count. Somebody who abandoned the form halfway
 * never got an outcome, and folding them in would make every question look
 * like it was turning people away.
 */
export function analyseQuestions(rows: readonly AnalysedResponse[]): QuestionInsight[] {
  const byQuestion = new Map<
    string,
    { prompt: string; answered: number; sentElsewhere: number; answers: Map<string, number> }
  >();

  for (const row of rows) {
    if (!row.completedAt) continue;

    for (const answer of row.answers) {
      let entry = byQuestion.get(answer.questionId);
      if (!entry) {
        entry = { prompt: answer.prompt, answered: 0, sentElsewhere: 0, answers: new Map() };
        byQuestion.set(answer.questionId, entry);
      }

      // The prompt as it reads most recently: a business that reworded a
      // question should see today's wording, not the version from March.
      entry.prompt = answer.prompt;
      entry.answered += 1;

      if (answer.outcomePathType === 'other') {
        entry.sentElsewhere += 1;
        entry.answers.set(answer.answer, (entry.answers.get(answer.answer) ?? 0) + 1);
      }
    }
  }

  return [...byQuestion.entries()]
    .map(([questionId, entry]) => ({
      questionId,
      prompt: entry.prompt,
      answered: entry.answered,
      sentElsewhere: entry.sentElsewhere,
      routingAnswers: [...entry.answers.entries()]
        .map(([answer, count]) => ({ answer, count }))
        .sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer)),
    }))
    // The biggest filter first. A business opening this page is looking for
    // the question that is costing them meetings, and it should be at the top.
    .sort(
      (a, b) =>
        b.sentElsewhere - a.sentElsewhere ||
        b.answered - a.answered ||
        a.prompt.localeCompare(b.prompt),
    );
}

/**
 * How each service is doing.
 *
 * Started and completed are counted separately because they fail in
 * different ways: a service nobody finishes has a form problem, and a
 * service everybody finishes but few qualify for has a rules problem. One
 * combined "conversion" number would hide which.
 */
export function analyseServices(rows: readonly AnalysedResponse[]): ServiceInsight[] {
  const byService = new Map<string, ServiceInsight>();
  const key = (id: string | null) => id ?? '';

  for (const row of rows) {
    let entry = byService.get(key(row.eventTypeId));
    if (!entry) {
      entry = { eventTypeId: row.eventTypeId, started: 0, completed: 0, meeting: 0, other: 0 };
      byService.set(key(row.eventTypeId), entry);
    }

    entry.started += 1;
    if (!row.completedAt) continue;

    entry.completed += 1;
    if (row.outcomePathType === 'meeting') entry.meeting += 1;
    if (row.outcomePathType === 'other') entry.other += 1;
  }

  return [...byService.values()].sort((a, b) => b.started - a.started);
}

/**
 * A share, as a whole percentage, with zero out of zero reading as zero
 * rather than as NaN — which is what a page would otherwise print in the
 * first week of a business's life.
 */
export function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}
