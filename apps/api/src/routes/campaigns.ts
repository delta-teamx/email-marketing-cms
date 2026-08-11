import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { db } from '../db.js';
import { requireUser, assertWorkspace } from '../auth.js';
import { sendEmail } from '../services/resend.js';
import { mergeContextForLead, renderEmailBody } from '../services/templates.js';

const statusBody = z.object({ status: z.enum(['active', 'paused']) });
const testSendBody = z.object({ to: z.string().email() });

async function loadCampaign(id: string) {
  const { data } = await db.from('campaigns').select('*').eq('id', id).maybeSingle();
  return data;
}

export function campaignRoutes(app: FastifyInstance): void {
  /** Activate / pause. Activation stamps warmup_started_at on first go-live. */
  app.post('/api/campaigns/:id/status', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = statusBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const campaign = await loadCampaign((req.params as { id: string }).id);
    if (!campaign || !assertWorkspace(user, campaign.workspace_id, reply)) return;

    const update: Record<string, unknown> = { status: parsed.data.status };
    if (parsed.data.status === 'active' && campaign.warmup_enabled && !campaign.warmup_started_at) {
      update.warmup_started_at = DateTime.now().setZone(campaign.timezone).toISODate();
    }
    const { error } = await db.from('campaigns').update(update).eq('id', campaign.id);
    if (error) return reply.code(500).send({ error: error.message });
    return { ok: true, status: parsed.data.status };
  });

  /** Send step-1 copy to yourself to preview rendering, footer, and headers. */
  app.post('/api/campaigns/:id/test-send', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = testSendBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const campaign = await loadCampaign((req.params as { id: string }).id);
    if (!campaign || !assertWorkspace(user, campaign.workspace_id, reply)) return;

    const { data: step } = await db
      .from('sequence_steps')
      .select('id, copy_variants(id, subject, body, enabled)')
      .eq('campaign_id', campaign.id)
      .eq('step_no', 1)
      .maybeSingle();
    const variant = (step?.copy_variants ?? []).find((v: any) => v.enabled) ?? (step?.copy_variants ?? [])[0];
    if (!variant) return reply.code(422).send({ error: 'no_copy', message: 'Add step 1 copy first.' });

    const sampleLead = {
      id: '00000000-0000-0000-0000-000000000000',
      email: parsed.data.to,
      first_name: 'Alex',
      last_name: 'Sample',
      company: 'Sample Practice',
      title: 'Practice Owner',
      phone: null,
      custom_fields: {},
    };
    const ctx = mergeContextForLead(sampleLead);
    const { text, html } = renderEmailBody(variant.body, ctx, sampleLead.id);
    try {
      await sendEmail({
        from: `${campaign.from_name} <${campaign.from_local_part}@${campaign.sending_domain}>`,
        to: parsed.data.to,
        subject: `[TEST] ${variant.subject}`,
        text,
        html,
      });
    } catch (err: any) {
      return reply.code(502).send({ error: 'send_failed', message: err?.message });
    }
    return { ok: true };
  });

  /** Funnel / per-step / per-variant analytics. */
  app.get('/api/campaigns/:id/stats', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const campaign = await loadCampaign((req.params as { id: string }).id);
    if (!campaign || !assertWorkspace(user, campaign.workspace_id, reply)) return;

    const { data, error } = await db.rpc('campaign_stats', { cid: campaign.id });
    if (error) return reply.code(500).send({ error: error.message });
    return data;
  });
}
