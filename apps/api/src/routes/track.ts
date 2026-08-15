import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { db } from '../db.js';
import { env } from '../env.js';
import { requireUser } from '../auth.js';

const trackBody = z.object({
  type: z.enum(['pageview', 'booking_started', 'booking_completed']).default('pageview'),
  page: z.string().max(300),
  referrer: z.string().max(500).optional(),
  utm: z.record(z.string().max(200)).optional(),
});

/** Daily-rotating anonymous visitor hash — no cookies, no stored PII. */
function visitorHash(ip: string, ua: string): string {
  const day = DateTime.utc().toISODate();
  return createHash('sha256')
    .update(`${ip}|${ua}|${day}|${env.unsubscribeSecret}`)
    .digest('hex')
    .slice(0, 24);
}

export function trackRoutes(app: FastifyInstance): void {
  /** First-party analytics beacon (public, called from the landing site). */
  app.post('/api/track', async (req, reply) => {
    const parsed = trackBody.safeParse(req.body);
    if (!parsed.success) return reply.code(204).send(); // never break the site over analytics
    await db
      .from('site_events')
      .insert({
        event_type: parsed.data.type,
        page: parsed.data.page,
        referrer: parsed.data.referrer ?? null,
        utm: parsed.data.utm ?? {},
        visitor_hash: visitorHash(req.ip, String(req.headers['user-agent'] ?? '')),
      })
      .then(() => {});
    return reply.code(204).send();
  });

  /** Dashboard analytics: site funnel + email performance + business rollups. */
  app.get('/api/stats', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const workspaceId = user.workspaceIds[0];
    if (!workspaceId) return reply.code(403).send({ error: 'no_workspace' });

    const days = Math.min(365, Math.max(1, Number((req.query as { days?: string }).days ?? 30)));
    const since = DateTime.utc().minus({ days }).toISO();

    const { data: stats, error } = await db.rpc('funnel_stats', { ws: workspaceId, since });
    if (error) return reply.code(500).send({ error: error.message });

    const [{ data: contracts }, { data: payments }] = await Promise.all([
      db.from('contracts').select('status').eq('workspace_id', workspaceId),
      db.from('payments').select('status, amount_cents, currency').eq('workspace_id', workspaceId),
    ]);

    const contractSummary: Record<string, number> = {};
    for (const c of contracts ?? []) contractSummary[c.status] = (contractSummary[c.status] ?? 0) + 1;

    const paymentSummary = { due_cents: 0, overdue_cents: 0, paid_cents: 0 };
    for (const p of payments ?? []) {
      if (p.status === 'paid') paymentSummary.paid_cents += p.amount_cents;
      else if (p.status === 'overdue') paymentSummary.overdue_cents += p.amount_cents;
      else if (p.status === 'due') paymentSummary.due_cents += p.amount_cents;
    }

    return { days, ...(stats as Record<string, unknown>), contracts: contractSummary, payments: paymentSummary };
  });
}
