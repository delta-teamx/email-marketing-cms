import type { FastifyInstance } from 'fastify';
import { COMPANY } from '@implenix/shared';
import { db } from '../db.js';
import { env } from '../env.js';
import { requireUser, assertWorkspace } from '../auth.js';
import { sendEmail } from '../services/resend.js';

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export function paymentRoutes(app: FastifyInstance): void {
  /**
   * One-click payment reminder email to the client. Payment CRUD itself goes
   * straight through Supabase from the dashboard (RLS-protected).
   */
  app.post('/api/payments/:id/remind', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { data: payment } = await db
      .from('payments')
      .select('*, contacts(email, first_name, workspace_id)')
      .eq('id', (req.params as { id: string }).id)
      .maybeSingle();
    const contact = (payment as Record<string, any> | null)?.contacts;
    if (!payment || !contact || !assertWorkspace(user, payment.workspace_id, reply)) return;
    if (payment.status === 'paid' || payment.status === 'waived') {
      return reply.code(409).send({ error: 'not_due' });
    }

    const amount = money(payment.amount_cents, payment.currency);
    const period = payment.period ? ` for ${payment.period}` : '';
    const due = payment.due_date ? ` (due ${payment.due_date})` : '';
    try {
      await sendEmail({
        from: env.mailFrom,
        to: contact.email,
        subject: `Implenix invoice reminder: ${amount}${period}`,
        text:
          `Hi ${contact.first_name ?? 'there'},\n\n` +
          `A friendly reminder that your Implenix billing-services payment of ${amount}${period}${due} is outstanding.\n\n` +
          (payment.description ? `Details: ${payment.description}\n\n` : '') +
          `If you've already sent it, please disregard this note. Any questions — just reply to this email.\n\n` +
          `Thank you,\nThe Implenix team\n\n--\n${COMPANY.name} · ${COMPANY.postalAddress}\n`,
        html:
          `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">` +
          `<p>Hi ${contact.first_name ?? 'there'},</p>` +
          `<p>A friendly reminder that your Implenix billing-services payment of <strong>${amount}</strong>${period}${due} is outstanding.</p>` +
          (payment.description ? `<p>Details: ${payment.description}</p>` : '') +
          `<p>If you've already sent it, please disregard this note. Any questions — just reply to this email.</p>` +
          `<p>Thank you,<br/>The Implenix team</p>` +
          `<p style="font-size:12px;color:#8a8a8a;">${COMPANY.name} · ${COMPANY.postalAddress}</p></div>`,
      });
    } catch (err: any) {
      return reply.code(502).send({ error: 'send_failed', message: err?.message });
    }
    return { ok: true };
  });
}
