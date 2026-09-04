import { BookingError } from './booking-service';
import type { TenantScope } from './db';
import type { OutcomePathType, QuestionKind } from './db/types';

const KINDS: QuestionKind[] = ['text', 'yes_no', 'single_choice'];
const PATH_TYPES: OutcomePathType[] = ['meeting', 'other'];

export interface OptionInput {
  label: string;
  outcomePathType: OutcomePathType;
}

export function requireKind(body: Record<string, unknown>): QuestionKind {
  const kind = body.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as QuestionKind)) {
    throw new BookingError('"kind" must be text, yes_no or single_choice', 400);
  }
  return kind as QuestionKind;
}

function requirePathType(value: unknown, context: string): OutcomePathType {
  if (typeof value !== 'string' || !PATH_TYPES.includes(value as OutcomePathType)) {
    throw new BookingError(`${context} needs a valid outcome path`, 400);
  }
  return value as OutcomePathType;
}

/**
 * Resolve an optional `eventTypeId` into what qualification_questions'
 * event_type_id column wants: null for "asked for every service" (the
 * absent case), or the id itself once confirmed to belong to this tenant —
 * see migration 0016. Deliberately does not require the event type to
 * still be active: an admin scoping a question to a service they've
 * temporarily paused is not a mistake worth blocking.
 */
export async function validateEventTypeId(
  scope: TenantScope,
  eventTypeId: string | undefined,
): Promise<string | null> {
  if (!eventTypeId) return null;

  const { data, error } = await scope.select('event_types', 'id').eq('id', eventTypeId).maybeSingle();
  if (error) throw error;
  if (!data) throw new BookingError('Unknown session type', 404);

  return eventTypeId;
}

/**
 * Turn whatever the request sent for `options` into the shape the
 * qualification_options_shape constraint requires, or throw.
 *
 * A text question always gets an empty array — there is nothing to route on
 * free-form text (brief 2.2). A yes/no question's labels are fixed to "Yes"
 * and "No"; the tenant only sets which path each one leads to, since letting
 * the labels drift is what the single_choice kind is for. A single_choice
 * question needs at least one real option, each with a non-empty label.
 */
export function normaliseOptions(
  kind: QuestionKind,
  body: Record<string, unknown>,
): OptionInput[] {
  if (kind === 'text') return [];

  if (kind === 'yes_no') {
    const flags = body.options;
    if (!Array.isArray(flags) || flags.length !== 2) {
      throw new BookingError('A yes/no question needs an outcome path for Yes and for No', 400);
    }
    return [
      { label: 'Yes', outcomePathType: requirePathType((flags[0] as OptionInput)?.outcomePathType, '"Yes"') },
      { label: 'No', outcomePathType: requirePathType((flags[1] as OptionInput)?.outcomePathType, '"No"') },
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
    return {
      label: label.trim(),
      outcomePathType: requirePathType((entry as OptionInput).outcomePathType, `Answer ${index + 1}`),
    };
  });
}
