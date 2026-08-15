import { DateTime } from 'luxon';
import { COMPANY, type BookingRequest, type BookingSlot } from '@implenix/shared';
import { env } from '../env.js';
import { db } from '../db.js';
import { getBusyIntervals, createEvent, cancelEvent } from './google-calendar.js';
import { sendEmail } from './resend.js';
import { reminderQueue } from '../queues/queues.js';

const B = env.booking;

function overlaps(aStart: DateTime, aEnd: DateTime, bStart: Date, bEnd: Date): boolean {
  return aStart.toMillis() < bEnd.getTime() && aEnd.toMillis() > bStart.getTime();
}

/**
 * Generate open slots whose start falls on `dateISO` (YYYY-MM-DD) as seen in
 * the visitor's timezone. Slots are generated inside the owner's working
 * hours (owner timezone), then filtered by Google free/busy, buffer, and
 * minimum notice.
 */
export async function getOpenSlots(dateISO: string, visitorTz: string): Promise<BookingSlot[]> {
  const visitorDayStart = DateTime.fromISO(dateISO, { zone: visitorTz }).startOf('day');
  if (!visitorDayStart.isValid) throw Object.assign(new Error('bad_date'), { statusCode: 400 });
  const visitorDayEnd = visitorDayStart.endOf('day');

  const now = DateTime.utc();
  const earliestStart = now.plus({ hours: B.minNoticeHours });

  // The visitor-local day can span two owner-local dates.
  const ownerDates = new Set<string>([
    visitorDayStart.setZone(B.timezone).toISODate()!,
    visitorDayEnd.setZone(B.timezone).toISODate()!,
  ]);

  const candidates: { start: DateTime; end: DateTime }[] = [];
  for (const ownerDate of ownerDates) {
    const day = DateTime.fromISO(ownerDate, { zone: B.timezone });
    if (!B.days.includes(day.weekday)) continue;
    for (const window of B.windows) {
      let cursor = day.set({ hour: window.start, minute: 0 });
      const windowEnd = day.set({ hour: window.end, minute: 0 });
      while (cursor.plus({ minutes: B.slotMinutes }) <= windowEnd) {
        const end = cursor.plus({ minutes: B.slotMinutes });
        const inVisitorDay = cursor >= visitorDayStart && cursor <= visitorDayEnd;
        if (inVisitorDay && cursor >= earliestStart) candidates.push({ start: cursor, end });
        cursor = cursor.plus({ minutes: B.slotMinutes });
      }
    }
  }
  candidates.sort((a, b) => a.start.toMillis() - b.start.toMillis());
  if (candidates.length === 0) return [];

  const rangeMin = candidates[0].start.minus({ minutes: B.bufferMinutes });
  const rangeMax = candidates[candidates.length - 1].end.plus({ minutes: B.bufferMinutes });
  const busy = await getBusyIntervals(rangeMin.toJSDate(), rangeMax.toJSDate());

  return candidates
    .filter((c) => {
      const withBufferStart = c.start.minus({ minutes: B.bufferMinutes });
      const withBufferEnd = c.end.plus({ minutes: B.bufferMinutes });
      return !busy.some((b) => overlaps(withBufferStart, withBufferEnd, b.start, b.end));
    })
    .map((c) => ({ start: c.start.toUTC().toISO()!, end: c.end.toUTC().toISO()! }));
}

/** Next N open slots from tomorrow onward — used by the AI booking agent. */
export async function getUpcomingSlots(count: number, tz: string): Promise<BookingSlot[]> {
  const out: BookingSlot[] = [];
  let day = DateTime.now().setZone(tz).plus({ days: 1 });
  for (let i = 0; i < 10 && out.length < count; i++) {
    const slots = await getOpenSlots(day.toISODate()!, tz);
    out.push(...slots.slice(0, Math.max(1, Math.ceil(count / 3))));
    day = day.plus({ days: 1 });
  }
  return out.slice(0, count);
}

export interface CreateBookingOptions {
  source: 'landing' | 'agent';
  workspaceId?: string | null;
  campaignId?: string | null;
  leadId?: string | null;
  sendConfirmationEmail?: boolean;
}

export class SlotTakenError extends Error {
  constructor() {
    super('slot_taken');
  }
}

export async function createBooking(req: BookingRequest, opts: CreateBookingOptions) {
  const start = DateTime.fromISO(req.start, { zone: 'utc' });
  if (!start.isValid) throw Object.assign(new Error('bad_start'), { statusCode: 400 });
  const end = start.plus({ minutes: B.slotMinutes });

  // Re-verify the slot against the calendar (with buffer) right before booking.
  const busy = await getBusyIntervals(
    start.minus({ minutes: B.bufferMinutes }).toJSDate(),
    end.plus({ minutes: B.bufferMinutes }).toJSDate(),
  );
  if (busy.some((b) => overlaps(start.minus({ minutes: B.bufferMinutes }), end.plus({ minutes: B.bufferMinutes }), b.start, b.end))) {
    throw new SlotTakenError();
  }

  const description = [
    `Booked via ${opts.source === 'landing' ? COMPANY.domain : 'Implenix outreach agent'}`,
    `Name: ${req.name}`,
    `Email: ${req.email}`,
    req.phone ? `Phone: ${req.phone}` : null,
    req.practice ? `Practice: ${req.practice}` : null,
    req.specialty ? `Specialty: ${req.specialty}` : null,
    req.notes ? `Notes: ${req.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const event = await createEvent({
    summary: `Implenix intro call — ${req.name}${req.practice ? ` (${req.practice})` : ''}`,
    description,
    start: start.toJSDate(),
    end: end.toJSDate(),
    attendeeEmail: req.email,
    attendeeName: req.name,
  });

  const { data: appt, error } = await db
    .from('appointments')
    .insert({
      workspace_id: opts.workspaceId ?? null,
      campaign_id: opts.campaignId ?? null,
      lead_id: opts.leadId ?? null,
      source: opts.source,
      google_event_id: event.eventId,
      meet_link: event.meetLink,
      starts_at: start.toISO(),
      ends_at: end.toISO(),
      attendee: {
        name: req.name,
        email: req.email,
        phone: req.phone ?? null,
        practice: req.practice ?? null,
        specialty: req.specialty ?? null,
        notes: req.notes ?? null,
        timezone: req.timezone,
      },
    })
    .select('id, cancel_token')
    .single();
  if (error) throw new Error(error.message);

  if (opts.sendConfirmationEmail !== false) {
    const local = start.setZone(req.timezone);
    const cancelUrl = `${env.apiPublicUrl}/api/booking/${appt.id}/cancel?token=${appt.cancel_token}`;
    const when = `${local.toFormat("cccc, LLLL d 'at' h:mm a")} (${req.timezone})`;
    await sendEmail({
      from: B.from,
      to: req.email,
      subject: `Confirmed: Implenix intro call — ${when}`,
      text:
        `Hi ${req.name.split(' ')[0]},\n\n` +
        `Your call with Implenix is confirmed.\n\n` +
        `When: ${when}\n` +
        (event.meetLink ? `Google Meet: ${event.meetLink}\n` : '') +
        `\nA calendar invite has been sent to this address.\n` +
        `Need to cancel? ${cancelUrl}\n\n` +
        `Talk soon,\nThe Implenix team\n\n--\n${COMPANY.name} · ${COMPANY.postalAddress}\n`,
      html:
        `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">` +
        `<p>Hi ${req.name.split(' ')[0]},</p>` +
        `<p>Your call with <strong>Implenix</strong> is confirmed.</p>` +
        `<p><strong>When:</strong> ${when}<br/>` +
        (event.meetLink ? `<strong>Google Meet:</strong> <a href="${event.meetLink}">${event.meetLink}</a></p>` : '</p>') +
        `<p>A calendar invite has been sent to this address.</p>` +
        `<p style="font-size:12px;color:#8a8a8a;">Need to cancel? <a href="${cancelUrl}">Cancel this booking</a><br/>` +
        `${COMPANY.name} · ${COMPANY.postalAddress}</p></div>`,
    });
  }

  // 24h reminder (only if the meeting is more than 24h out).
  const msUntilReminder = start.minus({ hours: 24 }).toMillis() - Date.now();
  if (msUntilReminder > 60_000) {
    await reminderQueue.add(
      'booking-reminder',
      { appointmentId: appt.id },
      { delay: msUntilReminder, jobId: `reminder:${appt.id}` },
    );
  }

  return {
    id: appt.id as string,
    start: start.toISO()!,
    end: end.toISO()!,
    meetLink: event.meetLink,
  };
}

export async function cancelBooking(appointmentId: string, token: string): Promise<boolean> {
  const { data: appt } = await db
    .from('appointments')
    .select('id, cancel_token, google_event_id, status')
    .eq('id', appointmentId)
    .single();
  if (!appt || appt.cancel_token !== token || appt.status === 'cancelled') return false;
  if (appt.google_event_id) {
    try {
      await cancelEvent(appt.google_event_id);
    } catch {
      // Event may already be gone — still mark cancelled locally.
    }
  }
  await db.from('appointments').update({ status: 'cancelled' }).eq('id', appointmentId);
  return true;
}
