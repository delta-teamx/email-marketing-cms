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
    const h = headers.find((x: any) => String(x?.name ?? '').toLowerCase() === name.toLowerCase());
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
      return reply.code(500).send({ error: 'processing_failed' }); // let Svix retry
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
  if (!eventType) return;

  const resendId = event.data?.email_id ?? event.data?.id;
  if (!resendId) return;
  const { data: message } = await db
    .from('messages')
    .select('id, workspace_id, contact_id')
    .eq('resend_id', resendId)
    .maybeSingle();
  if (!message) return;

  await db.from('email_events').insert({
    workspace_id: message.workspace_id,
    message_id: message.id,
    event_type: eventType,
    payload: event.data ?? {},
    occurred_at: event.created_at ?? DateTime.utc().toISO(),
  });

  if (eventType === 'delivered') {
    await db.from('messages').update({ status: 'delivered' }).eq('id', message.id);
  }

  if (eventType === 'bounced' || eventType === 'complained') {
    await db.from('messages').update({ status: 'bounced' }).eq('id', message.id);
    if (!message.contact_id) return;
    const { data: contact } = await db
      .from('contacts')
      .select('id, email, workspace_id')
      .eq('id', message.contact_id)
      .maybeSingle();
    if (!contact) return;
    const bounceType = String(event.data?.bounce?.type ?? event.data?.type ?? '').toLowerCase();
    const isHard =
      eventType === 'complained' || bounceType.includes('hard') || bounceType.includes('permanent') || bounceType === '';
    if (isHard) {
      await suppress(contact.email, contact.workspace_id, eventType === 'complained' ? 'complaint' : 'hard_bounce');
    }
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

  // Best match: threading header → our message → contact.
  let contactId: string | null = null;
  let workspaceId: string | null = null;
  if (inReplyTo) {
    const { data: parent } = await db
      .from('messages')
      .select('contact_id, workspace_id')
      .eq('smtp_message_id', inReplyTo)
      .maybeSingle();
    if (parent?.contact_id) {
      contactId = parent.contact_id;
      workspaceId = parent.workspace_id;
    }
  }
  // Fallback: sender email → contact.
  if (!contactId) {
    const { data: contact } = await db
      .from('contacts')
      .select('id, workspace_id')
      .eq('email', fromEmail)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (contact) {
      contactId = contact.id;
      workspaceId = contact.workspace_id;
    }
  }
  if (!contactId || !workspaceId) return; // unknown sender — ignore

  const { data: inserted, error } = await db
    .from('messages')
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
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

  await replyQueue.add(
    'triage-reply',
    { inboundMessageId: inserted.id },
    { ...defaultJobOpts, jobId: `inbound:${inserted.id}` },
  );
}
