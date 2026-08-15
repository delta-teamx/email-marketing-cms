import { DateTime } from 'luxon';
import { normalizeEmail, splitName, type BookingRequest, type BookingSlot } from '@implenix/shared';
import { env } from '../env.js';
import { db } from '../db.js';
import { getBusyIntervals, createEvent, cancelEvent } from './google-calendar.js';
import { getPrimaryWorkspaceId } from './workspace.js';
import { scheduleBookingFollowups, cancelPendingFollowups } from './followups.js';

const B = env.booking;

function overlaps(aStart: DateTime, aEnd: DateTime, bStart: Date, bEnd: Date): boolean {
  return aStart.toMillis() < bEnd.getTime() && aEnd.toMillis() > bStart.getTime();
}

/**
 * Generate open slots whose start falls on `dateISO` (YYYY-MM-DD) as seen in
 * the visitor's timezone. Slots are generated inside the owner's bookable
 * windows (owner timezone), then filtered by Google free/busy, buffer, and
 * minimum notice.
 */
export async function getOpenSlots(dateISO: string, visitorTz: string): Promise<BookingSlot[]> {
  const visitorDayStart = DateTime.fromISO(dateISO, { zone: visitorTz }).startOf('day');
  if (!visitorDayStart.isValid) throw Object.assign(new Error('bad_date'), { statusCode: 400 });
  const visitorDayEnd = visitorDayStart.endOf('day');

  const now = DateTime.utc();
  const earliestStart = now.plus({ hours: B.minNoticeHours });

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
      const s = c.start.minus({ minutes: B.bufferMinutes });
      const e = c.end.plus({ minutes: B.bufferMinutes });
      return !busy.some((b) => overlaps(s, e, b.start, b.end));
    })
    .map((c) => ({ start: c.start.toUTC().toISO()!, end: c.end.toUTC().toISO()! }));
}

export interface CreateBookingOptions {
  source: 'landing' | 'dashboard';
  /** Defaults to the primary workspace (landing-page bookings). */
  workspaceId?: string;
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

  const workspaceId = opts.workspaceId ?? (await getPrimaryWorkspaceId());

  // Re-verify the slot against the calendar (with buffer) right before booking.
  const busy = await getBusyIntervals(
    start.minus({ minutes: B.bufferMinutes }).toJSDate(),
    end.plus({ minutes: B.bufferMinutes }).toJSDate(),
  );
  if (
    busy.some((b) =>
      overlaps(start.minus({ minutes: B.bufferMinutes }), end.plus({ minutes: B.bufferMinutes }), b.start, b.end),
    )
  ) {
    throw new SlotTakenError();
  }

  // Upsert the contact by email.
  const email = normalizeEmail(req.email);
  const { first, last } = splitName(req.name);
  const contactValues = {
    workspace_id: workspaceId,
    email,
    first_name: first,
    last_name: last,
    phone: req.phone,
    practice_type: req.practice_type,
    patient_flow: req.patient_flow,
    timezone: req.timezone,
    source: opts.source,
    stage: 'booked',
    notes: req.notes ?? null,
  };
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .upsert(contactValues, { onConflict: 'workspace_id,email' })
    .select('id')
    .single();
  if (contactErr) throw new Error(contactErr.message);

  const description = [
    `Booked via ${opts.source === 'landing' ? 'implenix.net' : 'dashboard'}`,
    `Name: ${req.name}`,
    `Email: ${email}`,
    `Phone: ${req.phone}`,
    `Practice type: ${req.practice_type}`,
    `Patient flow: ${req.patient_flow}`,
    req.notes ? `Notes: ${req.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const event = await createEvent({
    summary: `Implenix intro call — ${req.name} (${req.practice_type})`,
    description,
    start: start.toJSDate(),
    end: end.toJSDate(),
    attendeeEmail: email,
    attendeeName: req.name,
  });

  const { data: appt, error } = await db
    .from('appointments')
    .insert({
      workspace_id: workspaceId,
      contact_id: contact.id,
      source: opts.source,
      google_event_id: event.eventId,
      meet_link: event.meetLink,
      starts_at: start.toISO(),
      ends_at: end.toISO(),
      attendee: {
        name: req.name,
        email,
        phone: req.phone,
        practice_type: req.practice_type,
        patient_flow: req.patient_flow,
        notes: req.notes ?? null,
        timezone: req.timezone,
      },
    })
    .select('id, cancel_token')
    .single();
  if (error) throw new Error(error.message);

  // Confirmation (instant) + reminder ladder (24h / 12h / 3h / 10m defaults).
  await scheduleBookingFollowups(appt.id);

  return {
    id: appt.id as string,
    start: start.toISO()!,
    end: end.toISO()!,
    meetLink: event.meetLink,
  };
}

/** Public cancel via emailed token link. */
export async function cancelBooking(appointmentId: string, token: string): Promise<boolean> {
  const { data: appt } = await db
    .from('appointments')
    .select('id, cancel_token, google_event_id, outcome, contact_id')
    .eq('id', appointmentId)
    .single();
  if (!appt || appt.cancel_token !== token || appt.outcome !== 'pending') return false;
  await performCancellation(appt);
  return true;
}

export async function performCancellation(appt: {
  id: string;
  google_event_id: string | null;
  contact_id: string | null;
}): Promise<void> {
  if (appt.google_event_id) {
    try {
      await cancelEvent(appt.google_event_id);
    } catch {
      // Event may already be gone — still cancel locally.
    }
  }
  await db.from('appointments').update({ outcome: 'cancelled' }).eq('id', appt.id);
  await cancelPendingFollowups(appt.id);
  if (appt.contact_id) {
    await db
      .from('contacts')
      .update({ stage: 'cancelled' })
      .eq('id', appt.contact_id)
      .eq('stage', 'booked');
  }
}
