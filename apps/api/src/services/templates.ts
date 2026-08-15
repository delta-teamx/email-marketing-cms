import { DateTime } from 'luxon';
import { COMPANY, renderMergeTags, type MergeContext } from '@implenix/shared';
import { env } from '../env.js';
import { unsubscribeUrl } from './unsubscribe.js';

export interface ContactRow {
  id: string;
  workspace_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  practice_type: string | null;
  patient_flow: string | null;
  timezone: string | null;
  custom_fields?: Record<string, unknown> | null;
}

export interface AppointmentRow {
  id: string;
  starts_at: string;
  ends_at: string;
  meet_link: string | null;
  attendee: Record<string, unknown>;
}

export function mergeContextFor(
  contact: ContactRow,
  appointment?: AppointmentRow | null,
): MergeContext {
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  const tz =
    contact.timezone ??
    (appointment?.attendee?.timezone as string | undefined) ??
    env.booking.timezone;

  const ctx: MergeContext = {
    first_name: contact.first_name,
    last_name: contact.last_name,
    full_name: fullName || null,
    email: contact.email,
    phone: contact.phone,
    practice_type: contact.practice_type,
    patient_flow: contact.patient_flow,
    booking_link: `${env.landingUrl}/book`,
  };
  if (appointment) {
    ctx.meeting_time = DateTime.fromISO(appointment.starts_at)
      .setZone(tz)
      .toFormat("cccc, LLLL d 'at' h:mm a ZZZZ");
    ctx.meet_link = appointment.meet_link ?? '';
  }
  return ctx;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render a template for a contact and append the footer (postal address +
 * unsubscribe link). Returns text and a minimal HTML version with links
 * auto-anchored.
 */
export function renderEmailBody(
  template: string,
  ctx: MergeContext,
  contactId: string,
): { text: string; html: string } {
  const body = renderMergeTags(template, ctx).trim();
  const unsub = unsubscribeUrl(contactId);

  const text =
    `${body}\n\n` +
    `--\n${COMPANY.name} · ${COMPANY.postalAddress}\n` +
    `Unsubscribe: ${unsub}\n`;

  const htmlBody = escapeHtml(body)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br/>');
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">` +
    `<p style="margin:0 0 16px 0;">${htmlBody}</p>` +
    `<p style="margin:24px 0 0 0;font-size:12px;color:#8a8a8a;border-top:1px solid #eee;padding-top:12px;">` +
    `${COMPANY.name} · ${escapeHtml(COMPANY.postalAddress)}<br/>` +
    `<a href="${unsub}" style="color:#8a8a8a;">Unsubscribe</a></p></div>`;

  return { text, html };
}
