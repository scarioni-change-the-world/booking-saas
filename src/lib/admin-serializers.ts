import type {
  AvailabilityRuleRow,
  DateOverrideRow,
  EventTypeRow,
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
    disqualificationMessage: row.disqualification_message,
    disqualificationRedirectUrl: row.disqualification_redirect_url,
    disqualificationRedirectLabel: row.disqualification_redirect_label,
    notificationEmail: row.notification_email,
    replyToEmail: row.reply_to_email,
    updatedAt: row.updated_at,
  };
}

export type SerializedSettings = ReturnType<typeof serializeSettings>;
