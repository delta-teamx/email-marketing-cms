import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PRACTICE_TYPES, PATIENT_FLOW_OPTIONS } from '@implenix/shared';
import {
  getOpenSlots,
  getAvailableDays,
  createBooking,
  cancelBooking,
  SlotTakenError,
} from '../services/booking-service.js';

const slotsQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tz: z.string().min(1).max(64),
});

const daysQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  tz: z.string().min(1).max(64),
});

export const bookingBody = z.object({
  start: z.string().datetime({ offset: true }),
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  phone: z.string().min(5).max(40),
  practice_type: z.enum(PRACTICE_TYPES),
  patient_flow: z.enum(PATIENT_FLOW_OPTIONS),
  notes: z.string().max(2000).optional(),
  timezone: z.string().min(1).max(64),
});

export function bookingRoutes(app: FastifyInstance): void {
  app.get('/api/booking/days', async (req, reply) => {
    const parsed = daysQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    try {
      const days = await getAvailableDays(parsed.data.month, parsed.data.tz);
      return { days };
    } catch (err: any) {
      if (err?.statusCode === 400) return reply.code(400).send({ error: 'bad_month' });
      req.log.error(err, 'days failed');
      return reply.code(502).send({ error: 'calendar_unavailable' });
    }
  });

  app.get('/api/booking/slots', async (req, reply) => {
    const parsed = slotsQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    try {
      const slots = await getOpenSlots(parsed.data.date, parsed.data.tz);
      return { slots };
    } catch (err: any) {
      if (err?.statusCode === 400) return reply.code(400).send({ error: 'bad_date' });
      req.log.error(err, 'slots failed');
      return reply.code(502).send({ error: 'calendar_unavailable' });
    }
  });

  app.post('/api/booking', async (req, reply) => {
    const parsed = bookingBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', details: parsed.error.flatten() });
    }
    try {
      const booking = await createBooking(parsed.data, { source: 'landing' });
      return reply.code(201).send(booking);
    } catch (err: any) {
      if (err instanceof SlotTakenError) return reply.code(409).send({ error: 'slot_taken' });
      if (err?.statusCode === 400) return reply.code(400).send({ error: 'bad_request' });
      req.log.error(err, 'booking failed');
      return reply.code(502).send({ error: 'booking_failed' });
    }
  });

  // Linked from confirmation emails — support both GET (click) and POST.
  const cancel = async (req: any, reply: any) => {
    const { id } = req.params as { id: string };
    const token = (req.query as { token?: string }).token ?? '';
    const ok = await cancelBooking(id, token);
    if (!ok) {
      return reply.code(404).type('text/html').send('<p>Booking not found or already cancelled.</p>');
    }
    return reply
      .type('text/html')
      .send('<p>Your booking has been cancelled. You can rebook any time at implenix.net/book.</p>');
  };
  app.get('/api/booking/:id/cancel', cancel);
  app.post('/api/booking/:id/cancel', cancel);
}
