import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Webhook } from 'svix';
import { DateTime } from 'luxon';
import { normalizeEmail } from '@implenix/shared';
import { db } from '../db.js';
import { env } from '../env.js';
import { suppress } from '../services/suppression.js';
import { replyQueue, defaultJobOpts } from '../queues/queues.js';

interface ResendEvent {
  type: string;
  created_at?: string;
  data: Record<string, any>;
}

function verifySignature(req: FastifyRequest): boolean {
  if (!env.resendWebhookSecret) return true; // verification disabled (local dev)
  const raw = (req as any).rawBody as string | undefined;
  if (!raw) return false;
  try {
    new Webhook(env.resendWebhookSecret).verify(raw, {
      'svix-id': String(req.headers['svix-id'] ?? ''),
      'svix-timestamp': String(req.headers['svix-timestamp'] ?? ''),
      'svix-signature': String(req.headers['svix-signature'] ?? ''),
    });
    return true;
  } catch {
    return false;
  }
}

function headerValue(headers: unknown, name: string): string | null {
  if (Array.isArray(headers)) {
    const h = headers.find(
      (x: any) => String(x?.name ?? '').toLowerCase() === name.toLowerCase(),
    );
    return h?.value ?? null;
  }
  if (headers && typeof headers === 'object') {
    const rec = headers as Record<string, string>;
    const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? rec[key] : null;
  }
  return null;
}

export function webhookRoutes(app: FastifyInstance): void {
  app.post('/api/webhooks/resend', async (req, reply) => {
    if (!verifySignature(req)) return reply.code(401).send({ error: 'bad_signature' });
    const event = req.body as ResendEvent;
    if (!event?.type) return reply.code(400).send({ error: 'bad_payload' });

    try {
      if (event.type === 'email.received' || event.type === 'inbound.email.received') {
        await handleInbound(event);
      } else if (event.type.startsWith('email.')) {
        await handleOutboundEvent(event);
      }
    } catch (err) {
      req.log.error(err, `webhook ${event.type} failed`);
      // 200 anyway for terminal data errors would lose retries; 500 lets Svix retry.
      return reply.code(500).send({ error: 'processing_failed' });
    }
    return { received: true };
  });
}

const EVENT_MAP: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

async function handleOutboundEvent(event: ResendEvent): Promise<void> {
  const eventType = EVENT_MAP[event.type];
  if (!eventType) return; // email.sent etc. — not tracked

  const resendId = event.data?.email_id ?? event.data?.id;
  if (!resendId) return;
  const { data: message } = await db
    .from('messages')
    .select('id, workspace_id, campaign_id, lead_id')
    .eq('resend_id', resendId)
    .maybeSingle();
  if (!message) return; // e.g. booking confirmations — not campaign mail

  await db.from('email_events').insert({
    workspace_id: message.workspace_id,
    campaign_id: message.campaign_id,
    message_id: message.id,
    event_type: eventType,
    payload: event.data ?? {},
    occurred_at: event.created_at ?? DateTime.utc().toISO(),
  });

  if (eventType === 'delivered') {
    await db.from('messages').update({ status: 'delivered' }).eq('id', message.id);
  }

  if (eventType === 'opened') {
    await db
      .from('leads')
      .update({ stage_key: 'opened' })
      .eq('id', message.lead_id)
      .in('stage_key', ['contacted']);
  }

  if (eventType === 'bounced' || eventType === 'complained') {
    await db.from('messages').update({ status: 'bounced' }).eq('id', message.id);
    const { data: lead } = await db
      .from('leads')
      .select('id, email, workspace_id')
      .eq('id', message.lead_id)
      .single();
    if (!lead) return;

    const bounceType = String(event.data?.bounce?.type ?? event.data?.type ?? '').toLowerCase();
    const isHard =
      eventType === 'complained' || bounceType.includes('hard') || bounceType.includes('permanent') || bounceType === '';
    if (isHard) {
      await suppress(lead.email, lead.workspace_id, eventType === 'complained' ? 'complaint' : 'hard_bounce');
    }
    await db
      .from('leads')
      .update({ status: 'suppressed', next_send_at: null, stage_key: 'bounced' })
      .eq('id', lead.id);
  }
}

async function handleInbound(event: ResendEvent): Promise<void> {
  const d = event.data ?? {};
  const fromEmail = normalizeEmail(
    typeof d.from === 'string' ? d.from.replace(/^.*<([^>]+)>.*$/, '$1') : String(d.from?.email ?? d.from ?? ''),
  );
  const toList: string[] = Array.isArray(d.to) ? d.to.map(String) : [String(d.to ?? '')];
  const toEmail = normalizeEmail(toList[0]?.replace(/^.*<([^>]+)>.*$/, '$1') ?? '');
  const subject = String(d.subject ?? '');
  const text = String(d.text ?? d.plain ?? '');
  const html = d.html ? String(d.html) : null;
  const inReplyTo = headerValue(d.headers, 'In-Reply-To');
  const messageId = headerValue(d.headers, 'Message-ID');
  if (!fromEmail) return;

  // 1. Best match: the reply's In-Reply-To points at one of our Message-IDs.
  let leadId: string | null = null;
  let campaignId: string | null = null;
  let workspaceId: string | null = null;

  if (inReplyTo) {
    const { data: parent } = await db
      .from('messages')
      .select('lead_id, campaign_id, workspace_id')
      .eq('smtp_message_id', inReplyTo)
      .maybeSingle();
    if (parent) {
      leadId = parent.lead_id;
      campaignId = parent.campaign_id;
      workspaceId = parent.workspace_id;
    }
  }

  // 2. Fallback: sender address + the campaign that owns the receiving domain.
  if (!leadId) {
    const toDomain = toEmail.split('@')[1] ?? '';
    const { data: candidates } = await db
      .from('leads')
      .select('id, campaign_id, workspace_id, campaigns!inner(sending_domain)')
      .eq('email', fromEmail)
      .order('updated_at', { ascending: false })
      .limit(10);
    const match = (candidates ?? []).find(
      (l: any) => l.campaigns?.sending_domain === toDomain,
    ) ?? (candidates ?? [])[0];
    if (match) {
      leadId = match.id;
      campaignId = match.campaign_id;
      workspaceId = match.workspace_id;
    }
  }

  if (!leadId || !campaignId || !workspaceId) return; // unknown sender — ignore

  const { data: inserted, error } = await db
    .from('messages')
    .insert({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      lead_id: leadId,
      direction: 'inbound',
      smtp_message_id: messageId,
      in_reply_to: inReplyTo,
      from_email: fromEmail,
      to_email: toEmail,
      subject,
      body_text: text,
      body_html: html,
      status: 'received',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // A real reply stops the sequence immediately, before the agent even runs.
  await db
    .from('leads')
    .update({
      status: 'finished',
      next_send_at: null,
      last_replied_at: DateTime.utc().toISO(),
    })
    .eq('id', leadId);

  await replyQueue.add(
    'process-reply',
    { inboundMessageId: inserted.id },
    { ...defaultJobOpts, jobId: `inbound:${inserted.id}` },
  );
}
