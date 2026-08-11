import { COMPANY, renderMergeTags, type MergeContext } from '@implenix/shared';
import { unsubscribeUrl } from './unsubscribe.js';

export interface LeadRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  custom_fields: Record<string, unknown> | null;
}

export function mergeContextForLead(lead: LeadRow): MergeContext {
  const custom: Record<string, string> = {};
  for (const [k, v] of Object.entries(lead.custom_fields ?? {})) {
    if (v != null) custom[k] = String(v);
  }
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
  return {
    ...custom,
    first_name: lead.first_name,
    last_name: lead.last_name,
    full_name: fullName || null,
    email: lead.email,
    company: lead.company,
    title: lead.title,
    phone: lead.phone,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render a human-provided plain-text template for a lead and append the
 * CAN-SPAM footer (postal address + unsubscribe link). Returns both text and
 * a minimal HTML version.
 */
export function renderEmailBody(
  template: string,
  ctx: MergeContext,
  leadId: string,
): { text: string; html: string } {
  const body = renderMergeTags(template, ctx).trim();
  const unsub = unsubscribeUrl(leadId);

  const text =
    `${body}\n\n` +
    `--\n${COMPANY.name} · ${COMPANY.postalAddress}\n` +
    `Unsubscribe: ${unsub}\n`;

  const htmlBody = escapeHtml(body).replace(/\n/g, '<br/>');
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">` +
    `<p style="margin:0 0 16px 0;">${htmlBody}</p>` +
    `<p style="margin:24px 0 0 0;font-size:12px;color:#8a8a8a;border-top:1px solid #eee;padding-top:12px;">` +
    `${COMPANY.name} · ${escapeHtml(COMPANY.postalAddress)}<br/>` +
    `<a href="${unsub}" style="color:#8a8a8a;">Unsubscribe</a></p></div>`;

  return { text, html };
}
