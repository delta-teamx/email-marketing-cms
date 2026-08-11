/**
 * @implenix/shared — types, constants, and helpers shared by the API,
 * dashboard, and landing site.
 */

// ---------------------------------------------------------------------------
// Company / brand constants
// ---------------------------------------------------------------------------

export const COMPANY = {
  name: 'Implenix',
  domain: 'implenix.net',
  dashboardDomain: 'marketing.implenix.net',
  postalAddress: '1879 NW 8th St, Miami, FL 33125',
} as const;

/** The only sending domains outreach campaigns are allowed to use. */
export const SENDING_DOMAINS = [
  'e.implenix.net',
  'm.implenix.net',
  's.implenix.net',
] as const;
export type SendingDomain = (typeof SENDING_DOMAINS)[number];

// ---------------------------------------------------------------------------
// Reply classification
// ---------------------------------------------------------------------------

export const REPLY_CATEGORIES = [
  'interested',
  'neutral',
  'not_interested',
  'dnc',
  'out_of_office',
  'wrong_person',
] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

/** Categories a campaign owner can write reply templates for. */
export const TEMPLATE_CATEGORIES = [
  'interested',
  'neutral',
  'not_interested',
  'dnc',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface DefaultStage {
  key: string;
  name: string;
  position: number;
  isTerminal: boolean;
}

/** GHL-style default pipeline seeded into every new campaign. */
export const DEFAULT_PIPELINE_STAGES: DefaultStage[] = [
  { key: 'new', name: 'New', position: 1, isTerminal: false },
  { key: 'contacted', name: 'Contacted', position: 2, isTerminal: false },
  { key: 'opened', name: 'Opened', position: 3, isTerminal: false },
  { key: 'replied', name: 'Replied', position: 4, isTerminal: false },
  { key: 'interested', name: 'Interested', position: 5, isTerminal: false },
  { key: 'meeting_booked', name: 'Meeting Booked', position: 6, isTerminal: false },
  { key: 'negotiating', name: 'Negotiating', position: 7, isTerminal: false },
  { key: 'sale_closed', name: 'Sale Closed', position: 8, isTerminal: true },
  { key: 'not_interested', name: 'Not Interested', position: 9, isTerminal: true },
  { key: 'dnc', name: 'DNC', position: 10, isTerminal: true },
  { key: 'bounced', name: 'Bounced / Bad Email', position: 11, isTerminal: true },
];

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'archived';
export type CampaignMode = 'full_auto' | 'review_first';
export type LeadStatus = 'active' | 'paused' | 'finished' | 'suppressed';
export type MessageDirection = 'outbound' | 'inbound';
export type AgentActionStatus = 'pending' | 'completed' | 'rejected';

export interface ReplyClassification {
  category: ReplyCategory;
  confidence: number; // 0..1
  meeting_intent: boolean;
  proposed_times: string[]; // free-text time expressions extracted from reply
  summary: string;
  ooo_return_date: string | null; // ISO date if out_of_office
}

// ---------------------------------------------------------------------------
// Booking API contract (used by the landing widget and the AI booking agent)
// ---------------------------------------------------------------------------

export interface BookingSlot {
  /** ISO datetime, UTC */
  start: string;
  /** ISO datetime, UTC */
  end: string;
}

export interface BookingRequest {
  start: string; // ISO datetime (UTC) of the chosen slot
  name: string;
  email: string;
  phone?: string;
  practice?: string;
  specialty?: string;
  notes?: string;
  timezone: string; // IANA tz of the visitor, e.g. "America/New_York"
}

export interface BookingResponse {
  id: string;
  start: string;
  end: string;
  meetLink: string | null;
}

// ---------------------------------------------------------------------------
// Merge tags
// ---------------------------------------------------------------------------

export interface MergeContext {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  company?: string | null;
  title?: string | null;
  phone?: string | null;
  [key: string]: string | null | undefined;
}

/**
 * Render `{{tag}}` and `{{tag|fallback}}` merge tags against a lead context.
 * Unknown tags with no fallback render as an empty string; whitespace left
 * behind by empty tags is collapsed.
 */
export function renderMergeTags(template: string, ctx: MergeContext): string {
  return template
    .replace(/\{\{\s*([\w.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (_m, tag: string, fallback?: string) => {
      const value = ctx[tag];
      if (value != null && String(value).trim() !== '') return String(value).trim();
      return fallback ?? '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?])/g, '$1');
}

/** Extract the set of merge tags used in a template (for validation UIs). */
export function extractMergeTags(template: string): string[] {
  const tags = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([\w.]+)\s*(?:\|[^}]*)?\}\}/g)) tags.add(m[1]);
  return [...tags];
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}
