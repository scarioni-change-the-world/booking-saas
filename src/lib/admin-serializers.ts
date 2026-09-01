import type { AnsweredQuestion } from './qualification';
import type {
  AvailabilityRuleRow,
  BookingRow,
  ClientRow,
  DateOverrideRow,
  EventTypeRow,
  OutcomePathRow,
  OutcomePathType,
  QualificationQuestionRow,
  TenantSettingsRow,
} from './db/types';

/**
 * Database rows use snake_case column names; the public booking API already
 * hands the browser camelCase (see components/types.ts). The admin API
 * follows the same convention rather than leaking raw column names into a
 * second, inconsistent shape.
 */
export function serializeEventType(row: EventTypeRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    color: row.color,
    sortOrder: row.sort_order,
    availableToProspects: row.available_to_prospects,
    availableToExistingClients: row.available_to_existing_clients,
    active: row.active,
    createdAt: row.created_at,
    bookingMode: row.booking_mode,
    packSize: row.pack_size,
  };
}

export type SerializedEventType = ReturnType<typeof serializeEventType>;

export function serializeQuestion(row: QualificationQuestionRow) {
  return {
    id: row.id,
    prompt: row.prompt,
    kind: row.kind,
    options: row.options,
    required: row.required,
    sortOrder: row.sort_order,
  };
}

export type SerializedQuestion = ReturnType<typeof serializeQuestion>;

/**
 * Postgres hands back a `time` column as "09:00:00" (seconds included). The
 * admin form uses a native `<input type="time">`, which speaks "09:00" — this
 * is the one place that difference needs trimming; the slot engine reads the
 * column straight off the database and never sees this serialized form.
 */
function toHHMM(value: string): string {
  return value.slice(0, 5);
}

export function serializeAvailabilityRule(row: AvailabilityRuleRow) {
  return {
    id: row.id,
    weekday: row.weekday,
    startTime: toHHMM(row.start_time),
    endTime: toHHMM(row.end_time),
  };
}

export type SerializedAvailabilityRule = ReturnType<typeof serializeAvailabilityRule>;

export function serializeDateOverride(row: DateOverrideRow) {
  return {
    id: row.id,
    date: row.date,
    isClosed: row.is_closed,
    startTime: row.start_time ? toHHMM(row.start_time) : null,
    endTime: row.end_time ? toHHMM(row.end_time) : null,
    note: row.note,
  };
}

export type SerializedDateOverride = ReturnType<typeof serializeDateOverride>;

export function serializeSettings(row: TenantSettingsRow) {
  return {
    bookingNoticeHours: row.booking_notice_hours,
    bookingWindowDays: row.booking_window_days,
    notificationEmail: row.notification_email,
    replyToEmail: row.reply_to_email,
    updatedAt: row.updated_at,
  };
}

export type SerializedSettings = ReturnType<typeof serializeSettings>;

/**
 * A path an answer can send a prospect down (migration 0011). `type` is the
 * one field that never changes once seeded — everything else the tenant can
 * edit.
 */
export function serializeOutcomePath(row: OutcomePathRow) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    message: row.message,
    redirectUrl: row.redirect_url,
    redirectLabel: row.redirect_label,
    updatedAt: row.updated_at,
  };
}

export type SerializedOutcomePath = ReturnType<typeof serializeOutcomePath>;

/**
 * A booking row as this list actually needs it: the event type's name and the
 * prospect's screening answers alongside it, rather than two more round trips
 * per row. Both arrive via PostgREST's foreign-key embedding — see
 * resolveBookingByToken for the same pattern used elsewhere in this codebase.
 *
 * qualification_responses stores its own full snapshot of the questions as
 * they read at submission time (prompt, kind, answer, outcomePathType)
 * rather than a reference back to qualification_questions, which is exactly
 * why this can show a prospect's real answers even after a question has
 * since been edited or removed.
 */
export interface BookingWithJoins extends BookingRow {
  event_types: { name: string } | null;
  qualification_responses: { answers: AnsweredQuestion[]; outcome_path_type: OutcomePathType } | null;
}

export function serializeBooking(row: BookingWithJoins) {
  return {
    id: row.id,
    eventTypeName: row.event_types?.name ?? 'Unknown session type',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    name: row.name,
    email: row.email,
    notes: row.notes,
    status: row.status,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    meetingUrl: row.meeting_url,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
    qualification: row.qualification_responses
      ? {
          outcomePathType: row.qualification_responses.outcome_path_type,
          answers: row.qualification_responses.answers,
        }
      : null,
    createdAt: row.created_at,
  };
}

export type SerializedBooking = ReturnType<typeof serializeBooking>;

export function serializeClient(row: ClientRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    accessToken: row.access_token,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export type SerializedClient = ReturnType<typeof serializeClient>;
