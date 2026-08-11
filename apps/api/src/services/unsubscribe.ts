import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

/**
 * Stateless signed unsubscribe tokens: base64url("leadId.signature").
 * The link is embedded in every outreach email and in the List-Unsubscribe
 * header (one-click, RFC 8058).
 */

function sign(leadId: string): string {
  return createHmac('sha256', env.unsubscribeSecret).update(leadId).digest('base64url');
}

export function unsubscribeToken(leadId: string): string {
  return Buffer.from(`${leadId}.${sign(leadId)}`).toString('base64url');
}

export function verifyUnsubscribeToken(token: string): string | null {
  try {
    const raw = Buffer.from(token, 'base64url').toString();
    const dot = raw.indexOf('.');
    if (dot <= 0) return null;
    const leadId = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expected = sign(leadId);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return leadId;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(leadId: string): string {
  return `${env.apiPublicUrl}/u/${unsubscribeToken(leadId)}`;
}
