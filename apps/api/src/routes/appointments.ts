import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { requireUser, assertWorkspace } from '../auth.js';
import { bookingBody } from './booking.js';
import { createBooking, performCancellation, SlotTakenError } from '../services/booking-service.js';
import { scheduleOutcomeFollowups } from '../services/followups.js';

const outcomeBody = z.object({ outcome: z.enum(['showed', 'no_show']) });

export function appointmentRoutes(app: FastifyInstance): void {
  /** Dashboard booking — same flow as the landing page, in the SDR's workspace. */
  app.post('/api/appointments', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const workspaceId = user.workspaceIds[0];
    if (!workspaceId) return reply.code(403).send({ error: 'no_workspace' });
    const parsed = bookingBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', details: parsed.error.flatten() });
    }
    try {
      const booking = await createBooking(parsed.data, { source: 'dashboard', workspaceId });
      return reply.code(201).send(booking);
    } catch (err: any) {
      if (err instanceof SlotTakenError) return reply.code(409).send({ error: 'slot_taken' });
      req.log.error(err, 'dashboard booking failed');
      return reply.code(502).send({ error: 'booking_failed' });
    }
  });

  /** Record the meeting outcome; fires the after-meeting follow-up sequence. */
  app.post('/api/appointments/:id/outcome', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = outcomeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const { data: appt } = await db
      .from('appointments')
      .select('id, workspace_id, contact_id, outcome')
      .eq('id', (req.params as { id: string }).id)
      .maybeSingle();
    if (!appt || !assertWorkspace(user, appt.workspace_id, reply)) return;
    if (appt.outcome === 'cancelled') return reply.code(409).send({ error: 'cancelled' });

    await db.from('appointments').update({ outcome: parsed.data.outcome }).eq('id', appt.id);
    if (appt.contact_id) {
      await db
        .from('contacts')
        .update({ stage: parsed.data.outcome === 'showed' ? 'showed' : 'no_show' })
        .eq('id', appt.contact_id)
        .in('stage', ['booked', 'new', 'no_show', 'showed']);
    }
    await scheduleOutcomeFollowups(appt.id, parsed.data.outcome);
    return { ok: true };
  });

  /** Cancel from the dashboard (no token needed — authed + workspace-checked). */
  app.post('/api/appointments/:id/cancel', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { data: appt } = await db
      .from('appointments')
      .select('id, workspace_id, contact_id, google_event_id, outcome')
      .eq('id', (req.params as { id: string }).id)
      .maybeSingle();
    if (!appt || !assertWorkspace(user, appt.workspace_id, reply)) return;
    if (appt.outcome !== 'pending') return reply.code(409).send({ error: 'not_pending' });
    await performCancellation(appt);
    return { ok: true };
  });
}
