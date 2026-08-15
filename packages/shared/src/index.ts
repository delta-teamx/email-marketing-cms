/**
 * @implenix/shared — types, constants, and helpers shared by the API,
 * dashboard, and landing site. (v2: booking-centric follow-up funnel.)
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

// ---------------------------------------------------------------------------
// Intake options (booking form — Calendly-style questions)
// ---------------------------------------------------------------------------

export const PRACTICE_TYPES = [
  'Family medicine',
  'Internal medicine',
  'Mental & behavioral health',
  'Physical & occupational therapy',
  'Chiropractic',
  'Pain management',
  'Podiatry',
  'Dermatology',
  'Cardiology',
  'Urgent care',
  'Laboratory',
  'Imaging center',
  'Other',
] as const;

export const PATIENT_FLOW_OPTIONS = [
  'Under 100 patients/month',
  '100–300 patients/month',
  '300–500 patients/month',
  '500+ patients/month',
] as const;

// ---------------------------------------------------------------------------
// Contact stages (funnel)
// ---------------------------------------------------------------------------

export const CONTACT_STAGES = [
  { key: 'new', name: 'New' },
  { key: 'booked', name: 'Booked' },
  { key: 'showed', name: 'Showed' },
  { key: 'negotiating', name: 'Negotiating' },
  { key: 'closed_won', name: 'Closed Won' },
  { key: 'no_show', name: 'No-show' },
  { key: 'cancelled', name: 'Cancelled' },
  { key: 'not_interested', name: 'Not Interested' },
  { key: 'dnc', name: 'DNC' },
] as const;
export type ContactStage = (typeof CONTACT_STAGES)[number]['key'];

// ---------------------------------------------------------------------------
// Follow-up sequence
// ---------------------------------------------------------------------------

export const FOLLOWUP_TRIGGERS = [
  'confirmation',
  'before_meeting',
  'after_showed',
  'after_no_show',
] as const;
export type FollowupTrigger = (typeof FOLLOWUP_TRIGGERS)[number];

export const FOLLOWUP_TRIGGER_LABELS: Record<FollowupTrigger, string> = {
  confirmation: 'Booking confirmation (instant)',
  before_meeting: 'Reminders before the meeting',
  after_showed: 'After the meeting (showed)',
  after_no_show: 'After a no-show',
};

/** Merge tags available in follow-up templates. */
export const FOLLOWUP_MERGE_TAGS = [
  'first_name',
  'last_name',
  'full_name',
  'email',
  'phone',
  'practice_type',
  'patient_flow',
  'meeting_time',
  'meet_link',
  'booking_link',
] as const;

// ---------------------------------------------------------------------------
// Reply classification (inbound triage)
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

export interface ReplyClassification {
  category: ReplyCategory;
  confidence: number; // 0..1
  meeting_intent: boolean;
  proposed_times: string[];
  summary: string;
  ooo_return_date: string | null;
}

export type AppointmentOutcome = 'pending' | 'showed' | 'no_show' | 'cancelled';

// ---------------------------------------------------------------------------
// Booking API contract (landing widget + dashboard booking)
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
  phone: string;
  practice_type: string;
  patient_flow: string;
  notes?: string;
  timezone: string; // IANA tz of the visitor
}

export interface BookingResponse {
  id: string;
  start: string;
  end: string;
  meetLink: string | null;
}

// ---------------------------------------------------------------------------
// Site analytics events
// ---------------------------------------------------------------------------

export type SiteEventType = 'pageview' | 'booking_started' | 'booking_completed';

// ---------------------------------------------------------------------------
// Merge tags
// ---------------------------------------------------------------------------

export interface MergeContext {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  practice_type?: string | null;
  patient_flow?: string | null;
  meeting_time?: string | null;
  meet_link?: string | null;
  booking_link?: string | null;
  [key: string]: string | null | undefined;
}

/**
 * Render `{{tag}}` and `{{tag|fallback}}` merge tags against a context.
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

export function splitName(full: string): { first: string; last: string | null } {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.length > 1 ? parts.slice(1).join(' ') : null };
}
