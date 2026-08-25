/**
 * Row shapes for the tables in supabase/migrations.
 *
 * Hand-written rather than generated so the repo has no dependency on a live
 * database to typecheck. Regenerate with `supabase gen types typescript` once a
 * project exists, and reconcile.
 */

export type TenantPlan = 'trial' | 'starter' | 'pro' | 'cancelled';
export type TenantStatus = 'active' | 'suspended' | 'deleted';
export type MemberRole = 'owner' | 'admin' | 'member';
export type BookingStatus = 'confirmed' | 'cancelled';
export type SyncStatus = 'pending' | 'synced' | 'failed' | 'not_configured';
export type QuestionKind = 'text' | 'yes_no' | 'single_choice';
export type QualificationOutcome = 'qualified' | 'redirected';
export type CalendarProviderId = 'google' | 'microsoft';
export type CalendarConnectionStatus = 'active' | 'needs_reconnect' | 'revoked';
export type PlatformRole = 'owner' | 'admin' | 'support';

export interface TenantBranding {
  logoUrl?: string;
  accentColor?: string;
  buttonColor?: string;
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  plan: TenantPlan;
  status: TenantStatus;
  branding: TenantBranding;
  embed_domains: string[];
  created_at: string;
}

export interface TenantSettingsRow {
  tenant_id: string;
  booking_notice_hours: number;
  booking_window_days: number;
  disqualification_message: string;
  disqualification_redirect_url: string | null;
  disqualification_redirect_label: string | null;
  notification_email: string | null;
  reply_to_email: string | null;
  updated_at: string;
}

export interface EventTypeRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  color: string;
  sort_order: number;
  available_to_prospects: boolean;
  available_to_existing_clients: boolean;
  active: boolean;
  created_at: string;
}

export interface AvailabilityRuleRow {
  id: string;
  tenant_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface DateOverrideRow {
  id: string;
  tenant_id: string;
  date: string;
  is_closed: boolean;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
}

export interface BlockedSlotRow {
  id: string;
  tenant_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface QualificationQuestionRow {
  id: string;
  tenant_id: string;
  prompt: string;
  kind: QuestionKind;
  options: Array<{ label: string; qualifies: boolean }>;
  required: boolean;
  sort_order: number;
}

export interface QualificationResponseRow {
  id: string;
  tenant_id: string;
  answers: unknown;
  outcome: QualificationOutcome;
  email: string | null;
  created_at: string;
}

export interface BookingRow {
  id: string;
  tenant_id: string;
  event_type_id: string;
  manage_token: string;
  starts_at: string;
  ends_at: string;
  name: string;
  email: string;
  notes: string | null;
  status: BookingStatus;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  qualification_response_id: string | null;
  calendar_event_id: string | null;
  meeting_url: string | null;
  sync_status: SyncStatus;
  sync_error: string | null;
  reminder_sent_at: string | null;
  created_at: string;
}

export interface CalendarConnectionRow {
  id: string;
  tenant_id: string;
  provider: CalendarProviderId;
  account_email: string;
  calendar_id: string;
  refresh_token_encrypted: string;
  access_token_encrypted: string | null;
  access_token_expires_at: string | null;
  granted_scopes: string[];
  status: CalendarConnectionStatus;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The company's own team, not any one tenant's — see migration 0009. Not a
 * TenantScopedTable: there is no tenant_id to scope by, which is the whole
 * point of it.
 */
export interface PlatformStaffRow {
  user_id: string;
  role: PlatformRole;
  added_by: string | null;
  created_at: string;
}

/** Every table whose rows belong to exactly one tenant. */
export interface TenantScopedTables {
  tenant_settings: TenantSettingsRow;
  event_types: EventTypeRow;
  availability_rules: AvailabilityRuleRow;
  date_overrides: DateOverrideRow;
  blocked_slots: BlockedSlotRow;
  qualification_questions: QualificationQuestionRow;
  qualification_responses: QualificationResponseRow;
  bookings: BookingRow;
  calendar_connections: CalendarConnectionRow;
}

export type TenantScopedTable = keyof TenantScopedTables;
