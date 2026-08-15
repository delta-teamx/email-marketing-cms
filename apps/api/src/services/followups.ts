import { DateTime } from 'luxon';
import { db } from '../db.js';
import { env } from '../env.js';
import { sendEmail } from './resend.js';
import { isSuppressed } from './suppression.js';
import { mergeContextFor, renderEmailBody, type ContactRow, type AppointmentRow } from './templates.js';
import { followupQueue, followupJobId, defaultJobOpts } from '../queues/queues.js';

interface StepRow {
  id: string;
  workspace_id: string;
  trigger: 'confirmation' | 'before_meeting' | 'after_showed' | 'after_no_show';
  offset_minutes: number;
  subject: string;
  body: string;
  enabled: boolean;
}

async function stepsFor(workspaceId: string, trigger: StepRow['trigger']): Promise<StepRow[]> {
  const { data } = await db
    .from('followup_steps')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('trigger', trigger)
    .eq('enabled', true)
    .order('position');
  return (data ?? []) as StepRow[];
}

/**
 * Called right after a booking is created: sends the confirmation instantly
 * and schedules every enabled before-meeting reminder that is still in the
 * future (T-24h / T-12h / T-3h / T-10m by default).
 */
export async function scheduleBookingFollowups(appointmentId: string): Promise<void> {
  const appt = await loadAppointment(appointmentId);
  if (!appt) return;

  for (const step of await stepsFor(appt.workspace_id, 'confirmation')) {
    await followupQueue.add(
      'send-followup',
      { appointmentId, stepId: step.id },
      { ...defaultJobOpts, jobId: followupJobId(appointmentId, step.id) },
    );
  }

  const startsAt = DateTime.fromISO(appt.starts_at);
  for (const step of await stepsFor(appt.workspace_id, 'before_meeting')) {
    const fireAt = startsAt.minus({ minutes: step.offset_minutes });
    const delay = fireAt.toMillis() - Date.now();
    if (delay <= 0) continue; // reminder already in the past at booking time
    await followupQueue.add(
      'send-followup',
      { appointmentId, stepId: step.id },
      { ...defaultJobOpts, delay, jobId: followupJobId(appointmentId, step.id) },
    );
  }
}

/** Called when the SDR records the meeting outcome (showed / no_show). */
export async function scheduleOutcomeFollowups(
  appointmentId: string,
  outcome: 'showed' | 'no_show',
): Promise<void> {
  const appt = await loadAppointment(appointmentId);
  if (!appt) return;
  const trigger = outcome === 'showed' ? 'after_showed' : 'after_no_show';
  for (const step of await stepsFor(appt.workspace_id, trigger)) {
    await followupQueue.add(
      'send-followup',
      { appointmentId, stepId: step.id },
      {
        ...defaultJobOpts,
        delay: step.offset_minutes * 60_000,
        jobId: followupJobId(appointmentId, step.id),
      },
    );
  }
}

/** Cancel all pending reminders for an appointment (cancellation/reschedule). */
export async function cancelPendingFollowups(appointmentId: string): Promise<void> {
  const appt = await loadAppointment(appointmentId);
  if (!appt) return;
  const { data: steps } = await db
    .from('followup_steps')
    .select('id')
    .eq('workspace_id', appt.workspace_id);
  for (const step of steps ?? []) {
    const job = await followupQueue.getJob(followupJobId(appointmentId, step.id));
    if (job) await job.remove().catch(() => {});
  }
}

async function loadAppointment(id: string) {
  const { data } = await db.from('appointments').select('*').eq('id', id).maybeSingle();
  return data as (AppointmentRow & { workspace_id: string; contact_id: string | null; outcome: string }) | null;
}

/**
 * Worker entry: render and send one follow-up step, re-validating state at
 * send time (appointment may have been cancelled, contact unsubscribed, or
 * the step edited/disabled since scheduling — edits apply automatically
 * because rendering happens here, not at scheduling time).
 */
export async function sendFollowupStep(appointmentId: string, stepId: string): Promise<void> {
  const appt = await loadAppointment(appointmentId);
  if (!appt || !appt.contact_id) return;

  const { data: step } = await db
    .from('followup_steps')
    .select('*')
    .eq('id', stepId)
    .maybeSingle();
  if (!step || !step.enabled) return;

  // State guards per trigger type.
  if (step.trigger === 'before_meeting' || step.trigger === 'confirmation') {
    if (appt.outcome !== 'pending') return; // cancelled or already concluded
  } else if (step.trigger === 'after_showed') {
    if (appt.outcome !== 'showed') return;
  } else if (step.trigger === 'after_no_show') {
    if (appt.outcome !== 'no_show') return;
  }

  const { data: contact } = await db
    .from('contacts')
    .select('*')
    .eq('id', appt.contact_id)
    .maybeSingle();
  if (!contact) return;
  if (contact.stage === 'dnc') return;
  if (await isSuppressed(contact.email, contact.workspace_id)) return;

  const ctx = mergeContextFor(contact as ContactRow, appt);
  const subject = ctx.meeting_time
    ? step.subject.replace(/\{\{\s*meeting_time\s*\}\}/g, ctx.meeting_time)
    : step.subject;
  const { text, html } = renderEmailBody(step.body, ctx, contact.id);

  const result = await sendEmail({
    from: env.mailFrom,
    to: contact.email,
    subject,
    text,
    html,
    leadId: contact.id,
  });

  await db.from('messages').insert({
    workspace_id: contact.workspace_id,
    contact_id: contact.id,
    appointment_id: appointmentId,
    followup_step_id: stepId,
    direction: 'outbound',
    resend_id: result.resendId,
    smtp_message_id: result.smtpMessageId,
    from_email: env.mailFrom.replace(/^.*<([^>]+)>.*$/, '$1'),
    to_email: contact.email,
    subject,
    body_text: text,
    status: 'sent',
    sent_at: DateTime.utc().toISO(),
  });
}
