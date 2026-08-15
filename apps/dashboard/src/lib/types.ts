/**
 * Row types matching supabase/migrations/0004_v2_booking_funnel.sql and
 * 0005_contracts_payments.sql exactly. Timestamps arrive as ISO strings;
 * numerics as numbers.
 */
import type {
  AppointmentOutcome,
  ContactStage,
  FollowupTrigger,
  ReplyCategory,
} from '@implenix/shared';

export type { AppointmentOutcome, ContactStage, FollowupTrigger, ReplyCategory };

export type MessageDirection = 'outbound' | 'inbound';
export type AgentActionStatus = 'pending' | 'completed' | 'rejected';
export type ContractStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'voided';
export type PaymentStatus = 'due' | 'paid' | 'overdue' | 'waived';

export interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
}

export interface ContactRow {
  id: string;
  workspace_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  practice_type: string | null;
  patient_flow: string | null;
  timezone: string | null;
  source: string;
  stage: ContactStage;
  notes: string | null;
  custom_fields: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface AppointmentRow {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  source: string;
  google_event_id: string | null;
  meet_link: string | null;
  starts_at: string;
  ends_at: string;
  attendee: Record<string, unknown>;
  outcome: AppointmentOutcome;
  cancel_token: string;
  created_at: string;
}

export interface FollowupStepRow {
  id: string;
  workspace_id: string;
  trigger: FollowupTrigger;
  offset_minutes: number;
  subject: string;
  body: string;
  enabled: boolean;
  position: number;
  created_at: string;
}

export interface MessageRow {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  appointment_id: string | null;
  followup_step_id: string | null;
  direction: MessageDirection;
  resend_id: string | null;
  smtp_message_id: string | null;
  in_reply_to: string | null;
  from_email: string;
  to_email: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  status: string;
  sent_at: string | null;
  created_at: string;
}

export interface EmailEventRow {
  id: string;
  workspace_id: string;
  message_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

/** `extracted` payload written by the reply-classification agent. */
export interface AgentExtracted {
  summary?: string;
  meeting_intent?: boolean;
  proposed_times?: string[];
  ooo_return_date?: string | null;
  [key: string]: unknown;
}

export interface AgentActionRow {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  inbound_message_id: string | null;
  classification: ReplyCategory;
  confidence: number;
  extracted: AgentExtracted;
  draft_subject: string | null;
  draft_body: string | null;
  action: string;
  status: AgentActionStatus;
  approved_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ContractTemplateRow {
  id: string;
  workspace_id: string;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface ContractRow {
  id: string;
  workspace_id: string;
  contact_id: string;
  template_id: string | null;
  kind: string;
  title: string;
  body_snapshot: string;
  status: ContractStatus;
  sign_token: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  signer_name: string | null;
  signer_title: string | null;
  signer_ip: string | null;
  declined_reason: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  workspace_id: string;
  contact_id: string;
  amount_cents: number;
  currency: string;
  period: string | null;
  description: string | null;
  status: PaymentStatus;
  due_date: string | null;
  paid_at: string | null;
  method: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuppressionRow {
  id: string;
  workspace_id: string | null;
  email: string;
  reason: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Joined shapes (supabase FK selects)
// ---------------------------------------------------------------------------

/** The contact columns embedded in joined selects. */
export type ContactSummary = Pick<
  ContactRow,
  'id' | 'email' | 'first_name' | 'last_name' | 'phone' | 'practice_type' | 'patient_flow' | 'stage'
>;

export interface AppointmentWithContact extends AppointmentRow {
  contacts: ContactSummary | null;
}

export interface ContractWithContact extends ContractRow {
  contacts: Pick<ContactRow, 'id' | 'email' | 'first_name' | 'last_name'> | null;
}

export interface PaymentWithContact extends PaymentRow {
  contacts: Pick<ContactRow, 'id' | 'email' | 'first_name' | 'last_name'> | null;
}

/** Approval-inbox item: agent action joined with contact and inbound message. */
export interface InboxItem extends AgentActionRow {
  contacts: Pick<ContactRow, 'id' | 'email' | 'first_name' | 'last_name'> | null;
  inbound_message: Pick<MessageRow, 'subject' | 'body_text' | 'from_email' | 'created_at'> | null;
}

// ---------------------------------------------------------------------------
// API contracts ({API}/api/stats etc.)
// ---------------------------------------------------------------------------

export interface SiteStats {
  pageviews: number;
  visitors: number;
  booking_started: number;
  booking_completed: number;
}

export interface FunnelStats {
  contacts: number;
  booked: number;
  upcoming: number;
  showed: number;
  no_show: number;
  cancelled: number;
  negotiating: number;
  closed_won: number;
}

export interface EmailStepStats {
  step_id: string;
  trigger: FollowupTrigger;
  position: number;
  subject: string;
  sent: number;
  opened: number;
  clicked: number;
}

export interface PaymentTotals {
  due_cents: number;
  overdue_cents: number;
  paid_cents: number;
}

export interface StatsResponse {
  days: number;
  site: SiteStats;
  funnel: FunnelStats;
  email: EmailStepStats[];
  contracts: Partial<Record<ContractStatus, number>>;
  payments: PaymentTotals;
}
