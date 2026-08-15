import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { db } from '../db.js';
import { env } from '../env.js';
import { requireUser, assertWorkspace } from '../auth.js';
import { sendEmail } from '../services/resend.js';
import { mergeContextFor, renderEmailBody, type ContactRow } from '../services/templates.js';

const replyBody = z.object({
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(20_000),
});

export function agentActionRoutes(app: FastifyInstance): void {
  /** Send a reply to an inbound message from the Approval Inbox. */
  app.post('/api/agent-actions/:id/reply', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = replyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const { data: action } = await db
      .from('agent_actions')
      .select('*')
      .eq('id', (req.params as { id: string }).id)
      .eq('status', 'pending')
      .maybeSingle();
    if (!action || !assertWorkspace(user, action.workspace_id, reply)) return;

    const { data: contact } = await db
      .from('contacts')
      .select('*')
      .eq('id', action.contact_id)
      .single();
    if (!contact) return reply.code(404).send({ error: 'not_found' });

    const { data: inbound } = action.inbound_message_id
      ? await db.from('messages').select('*').eq('id', action.inbound_message_id).single()
      : { data: null };

    const baseSubject = (inbound?.subject ?? '').replace(/^re:\s*/i, '').trim();
    const subject = parsed.data.subject ?? (baseSubject ? `Re: ${baseSubject}` : 'Re: your message');
    const ctx = mergeContextFor(contact as ContactRow);
    const { text, html } = renderEmailBody(parsed.data.body, ctx, contact.id);

    try {
      const result = await sendEmail({
        from: env.mailFrom,
        to: contact.email,
        subject,
        text,
        html,
        inReplyTo: inbound?.smtp_message_id ?? null,
        references: inbound?.smtp_message_id ? [inbound.smtp_message_id] : null,
        leadId: contact.id,
      });
      await db.from('messages').insert({
        workspace_id: contact.workspace_id,
        contact_id: contact.id,
        direction: 'outbound',
        resend_id: result.resendId,
        smtp_message_id: result.smtpMessageId,
        in_reply_to: inbound?.smtp_message_id ?? null,
        from_email: env.mailFrom.replace(/^.*<([^>]+)>.*$/, '$1'),
        to_email: contact.email,
        subject,
        body_text: text,
        status: 'sent',
        sent_at: DateTime.utc().toISO(),
      });
    } catch (err: any) {
      return reply.code(502).send({ error: 'send_failed', message: err?.message });
    }

    await db
      .from('agent_actions')
      .update({
        status: 'completed',
        action: 'replied',
        draft_subject: subject,
        draft_body: parsed.data.body,
        approved_by: user.id,
        completed_at: DateTime.utc().toISO(),
      })
      .eq('id', action.id);
    return { ok: true };
  });

  /** Dismiss an inbox item without replying. */
  app.post('/api/agent-actions/:id/dismiss', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { data: action } = await db
      .from('agent_actions')
      .select('id, workspace_id, status')
      .eq('id', (req.params as { id: string }).id)
      .eq('status', 'pending')
      .maybeSingle();
    if (!action || !assertWorkspace(user, action.workspace_id, reply)) return;
    await db
      .from('agent_actions')
      .update({ status: 'completed', action: 'dismissed', approved_by: user.id, completed_at: DateTime.utc().toISO() })
      .eq('id', action.id);
    return { ok: true };
  });
}
