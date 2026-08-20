import { BookingError } from './booking-service';
import type { QuestionKind } from './db/types';

const KINDS: QuestionKind[] = ['text', 'yes_no', 'single_choice'];

export interface OptionInput {
  label: string;
  qualifies: boolean;
}

export function requireKind(body: Record<string, unknown>): QuestionKind {
  const kind = body.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as QuestionKind)) {
    throw new BookingError('"kind" must be text, yes_no or single_choice', 400);
  }
  return kind as QuestionKind;
}

/**
 * Turn whatever the request sent for `options` into the shape the
 * qualification_options_shape constraint requires, or throw.
 *
 * A text question always gets an empty array — there is nothing to qualify
 * or disqualify on free-form text (brief 2.2). A yes/no question's labels
 * are fixed to "Yes" and "No"; the tenant only sets which one qualifies,
 * since letting the labels drift is what the single_choice kind is for. A
 * single_choice question needs at least one real option, each with a
 * non-empty label.
 */
export function normaliseOptions(
  kind: QuestionKind,
  body: Record<string, unknown>,
): OptionInput[] {
  if (kind === 'text') return [];

  if (kind === 'yes_no') {
    const flags = body.options;
    if (!Array.isArray(flags) || flags.length !== 2) {
      throw new BookingError('A yes/no question needs a qualifies flag for Yes and for No', 400);
    }
    return [
      { label: 'Yes', qualifies: Boolean((flags[0] as OptionInput)?.qualifies) },
      { label: 'No', qualifies: Boolean((flags[1] as OptionInput)?.qualifies) },
    ];
  }

  const raw = body.options;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BookingError('Add at least one answer', 400);
  }
  return raw.map((entry, index) => {
    const label = typeof entry === 'object' && entry ? (entry as OptionInput).label : undefined;
    if (typeof label !== 'string' || label.trim() === '') {
      throw new BookingError(`Answer ${index + 1} needs a label`, 400);
    }
    if (label.length > 200) {
      throw new BookingError(`Answer ${index + 1} is too long`, 400);
    }
    return { label: label.trim(), qualifies: Boolean((entry as OptionInput).qualifies) };
  });
}
