import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { db } from '../db.js';
import { requireUser, assertWorkspace } from '../auth.js';
import { sendAgentReply } from '../agent/replyAgent.js';
import type { LeadRow } from '../services/templates.js';

const approveBody = z.object({ body: z.string().min(1).max(20_000).optional() });

async function loadPendingAction(id: string) {
  const { data } = await db
    .from('agent_actions')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .maybeSingle();
  return data;
}

export function agentActionRoutes(app: FastifyInstance): void {
  /** Approve a queued reply (optionally with an edited body) and send it. */
  app.post('/api/agent-actions/:id/approve', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = approveBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const action = await loadPendingAction((req.params as { id: string }).id);
    if (!action || !assertWorkspace(user, action.workspace_id, reply)) return;

    const body = parsed.data.body ?? action.draft_body;
    if (!body) {
      return reply
        .code(422)
        .send({ error: 'no_draft', message: 'This action has no draft — write a reply body to send.' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*, campaigns(*)')
      .eq('id', action.lead_id)
      .single();
    const campaign = (lead as Record<string, any> | null)?.campaigns;
    if (!lead || !campaign) return reply.code(404).send({ error: 'not_found' });

    const { data: inbound } = action.inbound_message_id
      ? await db.from('messages').select('*').eq('id', action.inbound_message_id).single()
      : { data: null };

    try {
      await sendAgentReply({
        lead: lead as LeadRow & Record<string, any>,
        campaign,
        inbound: inbound ?? { subject: null, smtp_message_id: null, in_reply_to: null },
        body,
        templateCategory: action.template_category,
      });
    } catch (err: any) {
      return reply.code(502).send({ error: 'send_failed', message: err?.message });
    }

    await db
      .from('agent_actions')
      .update({
        status: 'completed',
        action: 'approved_sent',
        draft_body: body,
        approved_by: user.id,
        completed_at: DateTime.utc().toISO(),
      })
      .eq('id', action.id);
    return { ok: true };
  });

  /** Reject a queued reply — nothing is sent. */
  app.post('/api/agent-actions/:id/reject', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const action = await loadPendingAction((req.params as { id: string }).id);
    if (!action || !assertWorkspace(user, action.workspace_id, reply)) return;

    await db
      .from('agent_actions')
      .update({
        status: 'rejected',
        action: 'rejected',
        approved_by: user.id,
        completed_at: DateTime.utc().toISO(),
      })
      .eq('id', action.id);
    return { ok: true };
  });
}
