import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { env } from '../env.js';
import { sendEmail } from '../services/resend.js';

const contactBody = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  phone: z.string().max(40).optional(),
  message: z.string().min(1).max(5000),
  /** Honeypot — real users never fill this. */
  company_website: z.string().max(0).optional().or(z.literal('')),
});

export function contactRoutes(app: FastifyInstance): void {
  /** Contact-page form → email to the site owner. */
  app.post('/api/contact', async (req, reply) => {
    const parsed = contactBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    const { name, email, phone, message } = parsed.data;

    const to = process.env.CONTACT_TO ?? env.mailFrom.replace(/^.*<([^>]+)>.*$/, '$1');
    try {
      await sendEmail({
        from: env.mailFrom,
        to,
        subject: `Website contact: ${name}`,
        text:
          `New message from the implenix.net contact form:\n\n` +
          `Name: ${name}\nEmail: ${email}\n${phone ? `Phone: ${phone}\n` : ''}\n` +
          `${message}\n\n(Reply directly to reach them: ${email})`,
        html:
          `<p><strong>New message from the implenix.net contact form</strong></p>` +
          `<p>Name: ${name.replace(/</g, '&lt;')}<br/>Email: ${email}<br/>${phone ? `Phone: ${phone.replace(/</g, '&lt;')}` : ''}</p>` +
          `<p style="white-space:pre-wrap;">${message.replace(/</g, '&lt;')}</p>`,
      });
    } catch (err: any) {
      req.log.error(err, 'contact send failed');
      return reply.code(502).send({ error: 'send_failed' });
    }
    // Log as a site event for the analytics funnel.
    await db
      .from('site_events')
      .insert({ event_type: 'pageview', page: '/contact#submitted', utm: {} })
      .then(() => {});
    return reply.code(201).send({ ok: true });
  });
}
