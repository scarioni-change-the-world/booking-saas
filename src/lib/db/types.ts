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
/**
 * What answering a screening question leads to. Exactly two exist today —
 * see migration 0011 for why the roadmap's other path types (alternative
 * service, resource, referral, downloads, ...) are additive from here rather
 * than a rebuild.
 */
export type OutcomePathType = 'meeting' | 'other';
export type CalendarProviderId = 'google' | 'microsoft';
export type CalendarConnectionStatus = 'active' | 'needs_reconnect' | 'revoked';
export type PlatformRole = 'owner' | 'admin' | 'support';
/** How a session is booked (migration 0013) — declared on the session
 * itself, not on any one client's grant. See the migration for why this is
 * a declaration only and doesn't yet drive an actual checkout. */
export type BookingMode = 'single' | 'pack';

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
  notification_email: string | null;
  reply_to_email: string | null;
  updated_at: string;
}

/**
 * A path an answer can send a prospect down — see migration 0011. Exactly
 * one row per (tenant_id, type) exists in v1, auto-seeded on tenant creation.
 */
export interface OutcomePathRow {
  id: string;
  tenant_id: string;
  type: OutcomePathType;
  name: string;
  message: string;
  redirect_url: string | null;
  redirect_label: string | null;
  created_at: string;
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
  booking_mode: BookingMode;
  pack_size: number | null;
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
  created_at: string;
}

export interface QualificationQuestionRow {
  id: string;
  tenant_id: string;
  prompt: string;
  kind: QuestionKind;
  options: Array<{ label: string; outcomePathType: OutcomePathType }>;
  required: boolean;
  sort_order: number;
}

/**
 * A response has a lifecycle now (migration 0012): started the moment a
 * prospect gives their email, before they've answered anything, completed
 * once they finish and get scored. outcome_path_type and completed_at are
 * null together (a response in progress) or set together (finished) —
 * never a mix, enforced by the response_completion_paired constraint.
 */
export interface QualificationResponseRow {
  id: string;
  tenant_id: string;
  answers: unknown;
  outcome_path_type: OutcomePathType | null;
  email: string | null;
  started_at: string;
  completed_at: string | null;
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
  /** Set when this booking drew down a package — see client_entitlements. */
  client_id: string | null;
  entitlement_id: string | null;
}

export interface ClientRow {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  access_token: string;
  notes: string | null;
  created_at: string;
}

/**
 * A grant of N sessions for one session type. One row per (client, event
 * type) — see migration 0010 for why a top-up raises total_sessions rather
 * than adding a second row.
 */
export interface ClientEntitlementRow {
  id: string;
  tenant_id: string;
  client_id: string;
  event_type_id: string;
  total_sessions: number;
  used_sessions: number;
  created_at: string;
  updated_at: string;
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

/** What an AI generation call is billed against — see migration 0015's
 * ai_usage_events.kind check constraint and src/lib/ai/usage.ts, which caps
 * each kind independently. One value today; a future AI feature (draft
 * history, per-service scoping, ...) adds its own rather than reusing this
 * one. */
export type AiUsageKind = 'intake_draft';

/**
 * One metered AI generation, recorded after it succeeds — see
 * src/lib/ai/usage.ts for why only successes are counted. Exists purely to
 * cap cost; nothing reads these rows back except that monthly count.
 */
export interface AiUsageEventRow {
  id: string;
  tenant_id: string;
  kind: AiUsageKind;
  created_at: string;
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
  outcome_paths: OutcomePathRow;
  bookings: BookingRow;
  calendar_connections: CalendarConnectionRow;
  clients: ClientRow;
  client_entitlements: ClientEntitlementRow;
  ai_usage_events: AiUsageEventRow;
}

export type TenantScopedTable = keyof TenantScopedTables;
