import { Worker } from 'bullmq';
import { DateTime } from 'luxon';
import { COMPANY } from '@implenix/shared';
import { redis } from './queues.js';
import { runSchedulerTick } from './scheduler.js';
import { sendSequenceEmail } from '../engine/sendEngine.js';
import { processInboundReply } from '../agent/replyAgent.js';
import { db } from '../db.js';
import { env } from '../env.js';
import { sendEmail } from '../services/resend.js';

export function startWorkers(): Worker[] {
  const tick = new Worker('tick', async () => runSchedulerTick(), {
    connection: redis,
    concurrency: 1,
  });

  const send = new Worker(
    'send',
    async (job) => sendSequenceEmail(job.data.leadId as string),
    { connection: redis, concurrency: 3 },
  );

  const replies = new Worker(
    'reply',
    async (job) => processInboundReply(job.data.inboundMessageId as string),
    { connection: redis, concurrency: 3 },
  );

  const reminders = new Worker(
    'reminder',
    async (job) => sendBookingReminder(job.data.appointmentId as string),
    { connection: redis, concurrency: 2 },
  );

  for (const w of [tick, send, replies, reminders]) {
    w.on('failed', (job, err) => {
      console.error(`[worker:${w.name}] job ${job?.id} failed:`, err.message);
    });
  }
  return [tick, send, replies, reminders];
}

async function sendBookingReminder(appointmentId: string): Promise<void> {
  const { data: appt } = await db
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .maybeSingle();
  if (!appt || appt.status !== 'confirmed') return;

  const attendee = (appt.attendee ?? {}) as Record<string, string | null>;
  const email = attendee.email;
  if (!email) return;
  const tz = attendee.timezone ?? env.booking.timezone;
  const when = DateTime.fromISO(appt.starts_at).setZone(tz).toFormat("cccc, LLLL d 'at' h:mm a");
  const name = (attendee.name ?? '').split(' ')[0] || 'there';

  await sendEmail({
    from: env.booking.from,
    to: email,
    subject: `Reminder: your Implenix call is tomorrow — ${when}`,
    text:
      `Hi ${name},\n\nA quick reminder about your call with Implenix tomorrow.\n\n` +
      `When: ${when} (${tz})\n` +
      (appt.meet_link ? `Google Meet: ${appt.meet_link}\n` : '') +
      `\nSee you then,\nThe Implenix team\n\n--\n${COMPANY.name} · ${COMPANY.postalAddress}\n`,
    html:
      `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">` +
      `<p>Hi ${name},</p><p>A quick reminder about your call with <strong>Implenix</strong> tomorrow.</p>` +
      `<p><strong>When:</strong> ${when} (${tz})` +
      (appt.meet_link ? `<br/><strong>Google Meet:</strong> <a href="${appt.meet_link}">${appt.meet_link}</a>` : '') +
      `</p><p>See you then,<br/>The Implenix team</p>` +
      `<p style="font-size:12px;color:#8a8a8a;">${COMPANY.name} · ${COMPANY.postalAddress}</p></div>`,
  });
}
