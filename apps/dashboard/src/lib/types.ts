/**
 * Row types matching supabase/migrations/0001_init.sql exactly.
 * Timestamps arrive as ISO strings; numerics as numbers.
 */
import type {
  CampaignMode,
  CampaignStatus,
  LeadStatus,
  MessageDirection,
  AgentActionStatus,
  ReplyCategory,
  TemplateCategory,
  SendingDomain,
} from '@implenix/shared';

export type {
  CampaignMode,
  CampaignStatus,
  LeadStatus,
  MessageDirection,
  AgentActionStatus,
  ReplyCategory,
  TemplateCategory,
  SendingDomain,
};

export interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
}

export interface WorkspaceMemberRow {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'member';
  created_at: string;
}

export interface CampaignRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  mode: CampaignMode;
  sending_domain: SendingDomain;
  from_name: string;
  from_local_part: string;
  timezone: string;
  send_window_start: number;
  send_window_end: number;
  send_days: number[];
  daily_cap: number;
  warmup_enabled: boolean;
  warmup_start: number;
  warmup_increment: number;
  warmup_started_at: string | null;
  confidence_threshold: number;
  auto_categories: ReplyCategory[];
  created_at: string;
  updated_at: string;
}

export interface SequenceStepRow {
  id: string;
  campaign_id: string;
  step_no: number;
  delay_days: number;
}

export interface CopyVariantRow {
  id: string;
  step_id: string;
  label: string;
  subject: string;
  body: string;
  weight: number;
  enabled: boolean;
}

export interface StepWithVariants extends SequenceStepRow {
  copy_variants: CopyVariantRow[];
}

export interface ReplyTemplateRow {
  id: string;
  campaign_id: string;
  category: TemplateCategory;
  body: string;
}

export interface PipelineStageRow {
  id: string;
  campaign_id: string;
  key: string;
  name: string;
  position: number;
  is_terminal: boolean;
}

export interface LeadRow {
  id: string;
  campaign_id: string;
  workspace_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  custom_fields: Record<string, string>;
  stage_key: string;
  status: LeadStatus;
  current_step: number;
  next_send_at: string | null;
  snoozed_until: string | null;
  last_replied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  lead_id: string;
  direction: MessageDirection;
  resend_id: string | null;
  smtp_message_id: string | null;
  in_reply_to: string | null;
  step_no: number | null;
  variant_id: string | null;
  template_category: TemplateCategory | null;
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
  campaign_id: string;
  message_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface AgentActionRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  lead_id: string;
  inbound_message_id: string | null;
  classification: ReplyCategory;
  confidence: number;
  extracted: Record<string, unknown>;
  template_category: TemplateCategory | null;
  draft_subject: string | null;
  draft_body: string | null;
  action: string;
  status: AgentActionStatus;
  approved_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SuppressionRow {
  id: string;
  workspace_id: string | null;
  email: string;
  reason: string;
  created_at: string;
}

/** Approval-inbox item: agent action joined with lead, campaign and inbound message. */
export interface InboxItem extends AgentActionRow {
  leads: Pick<LeadRow, 'email' | 'first_name' | 'last_name' | 'company'> | null;
  campaigns: Pick<CampaignRow, 'id' | 'name'> | null;
  inbound_message: Pick<
    MessageRow,
    'subject' | 'body_text' | 'from_email' | 'created_at'
  > | null;
}

// ---------------------------------------------------------------------------
// API contracts ({API}/api/campaigns/:id/stats etc.)
// ---------------------------------------------------------------------------

export interface FunnelStats {
  leads: number;
  contacted: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  interested: number;
  meetings: number;
  closed: number;
}

export interface VariantStats {
  variant_id: string;
  label: string;
  step_no: number;
  sent: number;
  opened: number;
  replied: number;
}

export interface StepStats {
  step_no: number;
  sent: number;
  opened: number;
  replied: number;
}

export interface CampaignStats {
  funnel: FunnelStats;
  byVariant: VariantStats[];
  byStep: StepStats[];
}
