import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { db } from '../db.js';
import { env } from '../env.js';
import { requireUser, assertWorkspace } from '../auth.js';
import { sendEmail } from '../services/resend.js';
import { renderEmailBody } from '../services/templates.js';

const testSendBody = z.object({ to: z.string().email() });

export function followupRoutes(app: FastifyInstance): void {
  /** Send a follow-up step to yourself with sample data to preview it. */
  app.post('/api/followups/:id/test-send', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = testSendBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const { data: step } = await db
      .from('followup_steps')
      .select('*')
      .eq('id', (req.params as { id: string }).id)
      .maybeSingle();
    if (!step || !assertWorkspace(user, step.workspace_id, reply)) return;

    const sampleTime = DateTime.now()
      .setZone(env.booking.timezone)
      .plus({ days: 1 })
      .set({ hour: 11, minute: 0 })
      .toFormat("cccc, LLLL d 'at' h:mm a ZZZZ");
    const ctx = {
      first_name: 'Alex',
      last_name: 'Sample',
      full_name: 'Alex Sample',
      email: parsed.data.to,
      phone: '(305) 555-0123',
      practice_type: 'Family medicine',
      patient_flow: '100–300 patients/month',
      meeting_time: sampleTime,
      meet_link: 'https://meet.google.com/xxx-sample-xxx',
      booking_link: `${env.landingUrl}/book`,
    };
    const subject = `[TEST] ${step.subject.replace(/\{\{\s*meeting_time\s*\}\}/g, sampleTime)}`;
    const { text, html } = renderEmailBody(step.body, ctx, '00000000-0000-0000-0000-000000000000');
    try {
      await sendEmail({ from: env.mailFrom, to: parsed.data.to, subject, text, html });
    } catch (err: any) {
      return reply.code(502).send({ error: 'send_failed', message: err?.message });
    }
    return { ok: true };
  });
}
