import { DateTime } from 'luxon';
import { db } from '../db.js';
import { sendEmail } from '../services/resend.js';
import { isSuppressed } from '../services/suppression.js';
import { mergeContextForLead, renderEmailBody, type LeadRow } from '../services/templates.js';
import { renderMergeTags } from '@implenix/shared';

interface VariantRow {
  id: string;
  label: string;
  subject: string;
  body: string;
  weight: number;
  enabled: boolean;
}

function pickWeighted(variants: VariantRow[]): VariantRow {
  const enabled = variants.filter((v) => v.enabled);
  const pool = enabled.length > 0 ? enabled : variants;
  const total = pool.reduce((s, v) => s + v.weight, 0);
  let r = Math.random() * total;
  for (const v of pool) {
    r -= v.weight;
    if (r <= 0) return v;
  }
  return pool[pool.length - 1];
}

/**
 * Send the next sequence step to a lead. Re-validates campaign/lead state and
 * suppression at send time (state may have changed since the tick enqueued it).
 */
export async function sendSequenceEmail(leadId: string): Promise<void> {
  const { data: lead } = await db
    .from('leads')
    .select('*, campaigns(*)')
    .eq('id', leadId)
    .single();
  if (!lead) return;
  const campaign = (lead as Record<string, any>).campaigns;
  if (!campaign || campaign.status !== 'active' || lead.status !== 'active') return;
  if (lead.snoozed_until && DateTime.fromISO(lead.snoozed_until) > DateTime.utc()) return;

  if (await isSuppressed(lead.email, campaign.workspace_id)) {
    await db
      .from('leads')
      .update({ status: 'suppressed', next_send_at: null, stage_key: 'dnc' })
      .eq('id', leadId);
    return;
  }

  const nextStepNo = (lead.current_step ?? 0) + 1;
  const { data: steps } = await db
    .from('sequence_steps')
    .select('id, step_no, delay_days, copy_variants(id, label, subject, body, weight, enabled)')
    .eq('campaign_id', campaign.id)
    .order('step_no', { ascending: true });
  if (!steps || steps.length === 0) return;

  const step = steps.find((s) => s.step_no === nextStepNo);
  if (!step) {
    // Sequence exhausted.
    await db.from('leads').update({ status: 'finished', next_send_at: null }).eq('id', leadId);
    return;
  }
  const variants = (step.copy_variants ?? []) as VariantRow[];
  if (variants.length === 0) return; // step has no copy yet — leave the lead queued

  const variant = pickWeighted(variants);
  const ctx = mergeContextForLead(lead as LeadRow);

  // Follow-ups thread under the first outbound message.
  let subject = renderMergeTags(variant.subject, ctx).trim();
  let inReplyTo: string | null = null;
  let references: string[] | null = null;
  if (nextStepNo > 1) {
    const { data: first } = await db
      .from('messages')
      .select('smtp_message_id, subject')
      .eq('lead_id', leadId)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (first?.smtp_message_id) {
      inReplyTo = first.smtp_message_id;
      references = [first.smtp_message_id];
      if (first.subject) subject = `Re: ${first.subject.replace(/^re:\s*/i, '')}`;
    }
  }

  const { text, html } = renderEmailBody(variant.body, ctx, leadId);
  const from = `${campaign.from_name} <${campaign.from_local_part}@${campaign.sending_domain}>`;

  const result = await sendEmail({
    from,
    to: lead.email,
    subject,
    text,
    html,
    inReplyTo,
    references,
    leadId,
  });

  await db.from('messages').insert({
    workspace_id: campaign.workspace_id,
    campaign_id: campaign.id,
    lead_id: leadId,
    direction: 'outbound',
    resend_id: result.resendId,
    smtp_message_id: result.smtpMessageId,
    in_reply_to: inReplyTo,
    step_no: nextStepNo,
    variant_id: variant.id,
    from_email: `${campaign.from_local_part}@${campaign.sending_domain}`,
    to_email: lead.email,
    subject,
    body_text: text,
    status: 'sent',
    sent_at: DateTime.utc().toISO(),
  });

  const nextStep = steps.find((s) => s.step_no === nextStepNo + 1);
  const update: Record<string, unknown> = {
    current_step: nextStepNo,
    stage_key: lead.stage_key === 'new' ? 'contacted' : lead.stage_key,
    snoozed_until: null,
  };
  if (nextStep) {
    // Next email lands at the start of the send window `delay_days` out.
    update.next_send_at = DateTime.now()
      .setZone(campaign.timezone)
      .plus({ days: nextStep.delay_days })
      .set({ hour: campaign.send_window_start, minute: 0, second: 0, millisecond: 0 })
      .toUTC()
      .toISO();
  } else {
    update.next_send_at = null;
    update.status = 'finished';
  }
  await db.from('leads').update(update).eq('id', leadId);
}
