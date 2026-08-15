import { DateTime } from 'luxon';
import { db } from '../db.js';
import { classifyReply } from '../services/claude.js';
import { suppress } from '../services/suppression.js';

/**
 * Triage one inbound reply: classify it with Claude and file it into the
 * Approval Inbox. DNC requests are honored immediately (suppression + stage);
 * everything else waits for a human to reply from the inbox.
 */
export async function triageInbound(inboundMessageId: string): Promise<void> {
  const { data: inbound } = await db
    .from('messages')
    .select('*')
    .eq('id', inboundMessageId)
    .single();
  if (!inbound || inbound.direction !== 'inbound' || !inbound.contact_id) return;

  const { data: contact } = await db
    .from('contacts')
    .select('*')
    .eq('id', inbound.contact_id)
    .single();
  if (!contact) return;

  const { data: lastOutbound } = await db
    .from('messages')
    .select('subject, body_text')
    .eq('contact_id', contact.id)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const cls = await classifyReply({
    ourSubject: lastOutbound?.subject ?? null,
    ourBody: lastOutbound?.body_text ?? null,
    replyFrom: inbound.from_email,
    replySubject: inbound.subject ?? '',
    replyBody: inbound.body_text ?? '',
  });

  let action = 'queued_for_review';
  if (cls.category === 'dnc') {
    await suppress(contact.email, contact.workspace_id, 'dnc_reply');
    await db.from('contacts').update({ stage: 'dnc' }).eq('id', contact.id);
    action = 'suppressed';
  }

  await db.from('agent_actions').insert({
    workspace_id: contact.workspace_id,
    contact_id: contact.id,
    inbound_message_id: inboundMessageId,
    classification: cls.category,
    confidence: cls.confidence,
    extracted: {
      summary: cls.summary,
      meeting_intent: cls.meeting_intent,
      proposed_times: cls.proposed_times,
      ooo_return_date: cls.ooo_return_date,
    },
    action,
    status: cls.category === 'out_of_office' ? 'completed' : 'pending',
    completed_at: cls.category === 'out_of_office' ? DateTime.utc().toISO() : null,
  });
}
