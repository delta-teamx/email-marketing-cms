import { randomUUID } from 'node:crypto';
import { Resend } from 'resend';
import { env } from '../env.js';
import { unsubscribeUrl } from './unsubscribe.js';

export const resend = new Resend(env.resendApiKey);

export interface OutboundEmail {
  from: string; // "Name <local@domain>"
  to: string;
  subject: string;
  text: string;
  html: string;
  /** RFC 5322 Message-ID of the message this replies to (threading). */
  inReplyTo?: string | null;
  references?: string[] | null;
  /** Lead id — adds the one-click List-Unsubscribe headers when present. */
  leadId?: string | null;
}

export interface SendResult {
  resendId: string;
  smtpMessageId: string;
}

/**
 * Send via Resend with our own stable Message-ID so follow-ups and agent
 * replies can thread correctly even before webhooks arrive.
 */
export async function sendEmail(msg: OutboundEmail): Promise<SendResult> {
  const domain = msg.from.match(/@([\w.-]+)>?$/)?.[1] ?? 'implenix.net';
  const smtpMessageId = `<${randomUUID()}@${domain}>`;

  const headers: Record<string, string> = { 'Message-ID': smtpMessageId };
  if (msg.inReplyTo) {
    headers['In-Reply-To'] = msg.inReplyTo;
    headers['References'] = (msg.references ?? [msg.inReplyTo]).join(' ');
  }
  if (msg.leadId) {
    headers['List-Unsubscribe'] = `<${unsubscribeUrl(msg.leadId)}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const { data, error } = await resend.emails.send({
    from: msg.from,
    to: [msg.to],
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    headers,
  });
  if (error || !data) {
    throw new Error(`Resend send failed: ${error?.message ?? 'unknown error'}`);
  }
  return { resendId: data.id, smtpMessageId };
}
