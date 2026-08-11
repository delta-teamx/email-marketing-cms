import { DateTime } from 'luxon';
import type { ReplyCategory, ReplyClassification, TemplateCategory } from '@implenix/shared';
import { TEMPLATE_CATEGORIES, renderMergeTags } from '@implenix/shared';
import { db } from '../db.js';
import { env } from '../env.js';
import { classifyReply } from '../services/claude.js';
import { sendEmail } from '../services/resend.js';
import { suppress } from '../services/suppression.js';
import { mergeContextForLead, renderEmailBody, type LeadRow } from '../services/templates.js';
import {
  createBooking,
  getUpcomingSlots,
  SlotTakenError,
} from '../services/booking-service.js';

/**
 * Mechanical (non-marketing) confirmation used only after the agent books a
 * meeting. All persuasive copy comes from the campaign owner's templates.
 */
const BOOKING_CONFIRMATION_TEXT = (when: string) =>
  `Perfect — you're booked for ${when}. A calendar invite with a Google Meet link is on its way to your inbox. Speak then!`;

interface AgentDecision {
  templateCategory: TemplateCategory | null;
  draftBody: string | null; // rendered reply body (pre-footer), null = no reply to send
  action: string;
  stageKey: string | null;
  leadUpdate: Record<string, unknown>;
}

function toTemplateCategory(category: ReplyCategory): TemplateCategory | null {
  return (TEMPLATE_CATEGORIES as readonly string[]).includes(category)
    ? (category as TemplateCategory)
    : null;
}

/** Try to interpret extracted proposed times as concrete future datetimes. */
function parseProposedTimes(times: string[]): DateTime[] {
  return times
    .map((t) => DateTime.fromISO(t, { setZone: true }))
    .filter((d) => d.isValid && d > DateTime.utc())
    .map((d) => d.toUTC());
}

async function slotsText(tz: string): Promise<string> {
  const slots = await getUpcomingSlots(3, tz);
  if (slots.length === 0) return '';
  return slots
    .map((s) => DateTime.fromISO(s.start).setZone(tz).toFormat("cccc, LLL d 'at' h:mm a ZZZZ"))
    .join('\n');
}

/**
 * Full agent pass over one inbound reply:
 * classify → decide → (auto-act | queue for approval) → audit-log.
 */
export async function processInboundReply(inboundMessageId: string): Promise<void> {
  const { data: inbound } = await db
    .from('messages')
    .select('*')
    .eq('id', inboundMessageId)
    .single();
  if (!inbound || inbound.direction !== 'inbound') return;

  const { data: lead } = await db
    .from('leads')
    .select('*, campaigns(*)')
    .eq('id', inbound.lead_id)
    .single();
  if (!lead) return;
  const campaign = (lead as Record<string, any>).campaigns;
  if (!campaign) return;

  const { data: lastOutbound } = await db
    .from('messages')
    .select('subject, body_text, smtp_message_id')
    .eq('lead_id', lead.id)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const classification = await classifyReply({
    campaignName: campaign.name,
    campaignDescription: campaign.description,
    outboundSubject: lastOutbound?.subject ?? null,
    outboundBody: lastOutbound?.body_text ?? null,
    replyFrom: inbound.from_email,
    replySubject: inbound.subject ?? '',
    replyBody: inbound.body_text ?? '',
  });

  // Booking a meeting emails the prospect a calendar invite, so the agent may
  // only do it when this action would be allowed to auto-send.
  const canAutoAct =
    campaign.mode === 'full_auto' &&
    classification.confidence >= Number(campaign.confidence_threshold) &&
    (campaign.auto_categories as string[]).includes(classification.category);

  const decision = await decide(
    classification,
    lead as LeadRow & Record<string, any>,
    campaign,
    canAutoAct,
  );

  // Safety-critical state changes happen immediately, approval-gated or not.
  if (classification.category === 'dnc') {
    await suppress(lead.email, campaign.workspace_id, 'dnc_reply');
  }
  if (Object.keys(decision.leadUpdate).length > 0 || decision.stageKey) {
    await db
      .from('leads')
      .update({ ...decision.leadUpdate, ...(decision.stageKey ? { stage_key: decision.stageKey } : {}) })
      .eq('id', lead.id);
  }

  const needsApproval =
    decision.draftBody !== null &&
    (campaign.mode === 'review_first' ||
      classification.confidence < Number(campaign.confidence_threshold) ||
      !(campaign.auto_categories as string[]).includes(classification.category));

  const baseAction = {
    workspace_id: campaign.workspace_id,
    campaign_id: campaign.id,
    lead_id: lead.id,
    inbound_message_id: inboundMessageId,
    classification: classification.category,
    confidence: classification.confidence,
    extracted: {
      summary: classification.summary,
      meeting_intent: classification.meeting_intent,
      proposed_times: classification.proposed_times,
      ooo_return_date: classification.ooo_return_date,
    },
    template_category: decision.templateCategory,
  };

  if (decision.draftBody === null) {
    // Nothing to send (OOO, wrong person, or missing template → manual).
    await db.from('agent_actions').insert({
      ...baseAction,
      action: decision.action,
      status: decision.action === 'queued_for_approval' ? 'pending' : 'completed',
      completed_at: decision.action === 'queued_for_approval' ? null : DateTime.utc().toISO(),
    });
    return;
  }

  if (needsApproval) {
    await db.from('agent_actions').insert({
      ...baseAction,
      draft_subject: replySubject(inbound.subject),
      draft_body: decision.draftBody,
      action: 'queued_for_approval',
      status: 'pending',
    });
    return;
  }

  await sendAgentReply({
    lead: lead as LeadRow & Record<string, any>,
    campaign,
    inbound,
    body: decision.draftBody,
    templateCategory: decision.templateCategory,
  });
  await db.from('agent_actions').insert({
    ...baseAction,
    draft_subject: replySubject(inbound.subject),
    draft_body: decision.draftBody,
    action: decision.action,
    status: 'completed',
    completed_at: DateTime.utc().toISO(),
  });
}

function replySubject(inboundSubject: string | null): string {
  const s = (inboundSubject ?? '').replace(/^re:\s*/i, '').trim();
  return s ? `Re: ${s}` : 'Re: your reply';
}

async function decide(
  cls: ReplyClassification,
  lead: LeadRow & Record<string, any>,
  campaign: Record<string, any>,
  allowBooking: boolean,
): Promise<AgentDecision> {
  const templateCategory = toTemplateCategory(cls.category);
  const ctx = mergeContextForLead(lead);

  // Non-reply categories -------------------------------------------------
  if (cls.category === 'out_of_office') {
    const returnDate = cls.ooo_return_date
      ? DateTime.fromISO(cls.ooo_return_date).plus({ days: 1 })
      : DateTime.utc().plus({ days: 14 });
    return {
      templateCategory: null,
      draftBody: null,
      action: 'snoozed',
      stageKey: 'contacted',
      leadUpdate: {
        status: 'active',
        snoozed_until: returnDate.toISO(),
        next_send_at: returnDate.toISO(),
      },
    };
  }
  if (cls.category === 'wrong_person') {
    return {
      templateCategory: null,
      draftBody: null,
      action: 'closed',
      stageKey: null,
      leadUpdate: { status: 'finished', next_send_at: null },
    };
  }

  // Reply categories — always answered with the owner's template ---------
  const { data: template } = await db
    .from('reply_templates')
    .select('body')
    .eq('campaign_id', campaign.id)
    .eq('category', templateCategory!)
    .maybeSingle();

  if (!template) {
    // No copy provided for this category — never improvise; route to a human.
    return {
      templateCategory,
      draftBody: null,
      action: 'queued_for_approval',
      stageKey: stageFor(cls.category),
      leadUpdate: {},
    };
  }

  let body = template.body as string;

  if (cls.category === 'interested') {
    // Meeting flow: if the prospect proposed a concrete free time, book it
    // and send a mechanical confirmation instead of the template.
    if (cls.meeting_intent && allowBooking) {
      const parsed = parseProposedTimes(cls.proposed_times);
      const tz = lead.custom_fields?.timezone ?? campaign.timezone;
      for (const t of parsed) {
        try {
          const booking = await createBooking(
            {
              start: t.toISO()!,
              name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email,
              email: lead.email,
              practice: lead.company ?? undefined,
              notes: `Booked by outreach agent — campaign "${campaign.name}".`,
              timezone: tz,
            },
            {
              source: 'agent',
              workspaceId: campaign.workspace_id,
              campaignId: campaign.id,
              leadId: lead.id,
              sendConfirmationEmail: false, // the reply itself confirms; invite comes from Google
            },
          );
          const when = DateTime.fromISO(booking.start)
            .setZone(tz)
            .toFormat("cccc, LLL d 'at' h:mm a ZZZZ");
          return {
            templateCategory,
            draftBody: BOOKING_CONFIRMATION_TEXT(when),
            action: 'booked_meeting',
            stageKey: 'meeting_booked',
            leadUpdate: {},
          };
        } catch (err) {
          if (err instanceof SlotTakenError) continue; // try their next proposed time
          break; // calendar failure — fall through to template reply
        }
      }
    }
    // Otherwise reply with the owner's interested template; support
    // {{available_slots}} and {{booking_link}} tags inside it.
    if (body.includes('{{available_slots}}')) {
      const tz = campaign.timezone;
      ctx['available_slots'] = await slotsText(tz);
    }
    ctx['booking_link'] = `${env.landingUrl}/book`;
    return {
      templateCategory,
      draftBody: bodyWithCtx(body, ctx),
      action: 'auto_replied',
      stageKey: 'interested',
      leadUpdate: {},
    };
  }

  if (cls.category === 'dnc') {
    return {
      templateCategory,
      draftBody: bodyWithCtx(body, ctx),
      action: 'suppressed',
      stageKey: 'dnc',
      leadUpdate: { status: 'suppressed', next_send_at: null },
    };
  }

  if (cls.category === 'not_interested') {
    return {
      templateCategory,
      draftBody: bodyWithCtx(body, ctx),
      action: 'auto_replied',
      stageKey: 'not_interested',
      leadUpdate: { status: 'finished', next_send_at: null },
    };
  }

  // neutral
  return {
    templateCategory,
    draftBody: bodyWithCtx(body, ctx),
    action: 'auto_replied',
    stageKey: 'replied',
    leadUpdate: {},
  };
}

function stageFor(category: ReplyCategory): string | null {
  switch (category) {
    case 'interested':
      return 'interested';
    case 'not_interested':
      return 'not_interested';
    case 'dnc':
      return 'dnc';
    case 'neutral':
      return 'replied';
    default:
      return null;
  }
}

function bodyWithCtx(template: string, ctx: Record<string, string | null | undefined>): string {
  // Render merge tags only — the footer is appended at send time.
  return renderMergeTags(template, ctx);
}

export interface SendAgentReplyInput {
  lead: LeadRow & Record<string, any>;
  campaign: Record<string, any>;
  inbound: Record<string, any>;
  body: string; // rendered body, no footer yet
  templateCategory: TemplateCategory | null;
}

/** Send an agent (or approved) reply, threaded under the inbound message. */
export async function sendAgentReply(input: SendAgentReplyInput): Promise<void> {
  const { lead, campaign, inbound } = input;
  const ctx = mergeContextForLead(lead);
  const { text, html } = renderEmailBody(input.body, ctx, lead.id);
  const from = `${campaign.from_name} <${campaign.from_local_part}@${campaign.sending_domain}>`;
  const subject = replySubject(inbound.subject);

  const references: string[] = [];
  if (inbound.in_reply_to) references.push(inbound.in_reply_to);
  if (inbound.smtp_message_id) references.push(inbound.smtp_message_id);

  const result = await sendEmail({
    from,
    to: lead.email,
    subject,
    text,
    html,
    inReplyTo: inbound.smtp_message_id ?? null,
    references: references.length ? references : null,
    leadId: lead.id,
  });

  await db.from('messages').insert({
    workspace_id: campaign.workspace_id,
    campaign_id: campaign.id,
    lead_id: lead.id,
    direction: 'outbound',
    resend_id: result.resendId,
    smtp_message_id: result.smtpMessageId,
    in_reply_to: inbound.smtp_message_id ?? null,
    template_category: input.templateCategory,
    from_email: `${campaign.from_local_part}@${campaign.sending_domain}`,
    to_email: lead.email,
    subject,
    body_text: text,
    status: 'sent',
    sent_at: DateTime.utc().toISO(),
  });
}
