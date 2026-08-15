import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { renderMergeTags, COMPANY } from '@implenix/shared';
import { db } from '../db.js';
import { env } from '../env.js';
import { requireUser, assertWorkspace } from '../auth.js';
import { sendEmail } from '../services/resend.js';
import { getWorkspaceOwnerEmail } from '../services/workspace.js';

const createBody = z.object({
  contact_id: z.string().uuid(),
  template_id: z.string().uuid(),
  /** Optional overrides merged into the template before snapshotting. */
  practice_name: z.string().max(300).optional(),
  practice_address: z.string().max(500).optional(),
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function contractPage(inner: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>Implenix — Agreement</title>` +
    `<style>body{font-family:Georgia,'Times New Roman',serif;max-width:46rem;margin:0 auto;padding:2.5rem 1.25rem;color:#1a2430;line-height:1.7}` +
    `pre{white-space:pre-wrap;font-family:inherit;font-size:1rem}` +
    `.head{font-family:Arial,sans-serif;border-bottom:3px solid #004e7a;padding-bottom:1rem;margin-bottom:2rem;display:flex;justify-content:space-between;align-items:center}` +
    `.head strong{color:#004e7a;font-size:1.3rem}` +
    `.badge{font-family:Arial,sans-serif;font-size:.8rem;background:#edf5fa;color:#004e7a;padding:.3rem .8rem;border-radius:99px}` +
    `.sign{font-family:Arial,sans-serif;background:#f4f8fb;border:1px solid #dce6ec;border-radius:12px;padding:1.5rem;margin-top:2rem}` +
    `label{display:block;font-size:.9rem;font-weight:bold;margin:.8rem 0 .25rem}` +
    `input[type=text]{width:100%;padding:.6rem;border:1px solid #b9c9d4;border-radius:8px;font-size:1rem;box-sizing:border-box}` +
    `.agree{display:flex;gap:.5rem;align-items:flex-start;margin:1rem 0;font-size:.95rem}` +
    `button{background:#004e7a;color:#fff;border:0;border-radius:8px;padding:.8rem 1.6rem;font-size:1rem;cursor:pointer}` +
    `.muted{color:#5a6b78;font-size:.85rem;font-family:Arial,sans-serif}</style></head><body>${inner}</body></html>`
  );
}

export function contractRoutes(app: FastifyInstance): void {
  /** Create a contract from a template and email the signing link. */
  app.post('/api/contracts', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const { data: contact } = await db
      .from('contacts')
      .select('*')
      .eq('id', parsed.data.contact_id)
      .maybeSingle();
    if (!contact || !assertWorkspace(user, contact.workspace_id, reply)) return;

    const { data: template } = await db
      .from('contract_templates')
      .select('*')
      .eq('id', parsed.data.template_id)
      .eq('workspace_id', contact.workspace_id)
      .maybeSingle();
    if (!template) return reply.code(404).send({ error: 'template_not_found' });

    const practiceName =
      parsed.data.practice_name ??
      [contact.first_name, contact.last_name].filter(Boolean).join(' ') + "'s practice";
    const snapshot = renderMergeTags(template.body, {
      effective_date: DateTime.now().setZone(env.booking.timezone).toFormat('LLLL d, yyyy'),
      practice_name: practiceName,
      practice_address: parsed.data.practice_address ?? '[practice address]',
      // signer fields stay as tags until signing:
      signer_name: '{{signer_name}}',
      signer_title: '{{signer_title}}',
    });

    const { data: contract, error } = await db
      .from('contracts')
      .insert({
        workspace_id: contact.workspace_id,
        contact_id: contact.id,
        template_id: template.id,
        kind: template.kind,
        title: template.title,
        body_snapshot: snapshot,
        status: 'sent',
        sent_at: DateTime.utc().toISO(),
      })
      .select('id, sign_token')
      .single();
    if (error) return reply.code(500).send({ error: error.message });

    const signUrl = `${env.apiPublicUrl}/c/${contract.sign_token}`;
    const first = contact.first_name ?? 'there';
    try {
      const result = await sendEmail({
        from: env.mailFrom,
        to: contact.email,
        subject: `${template.title} — Implenix`,
        text:
          `Hi ${first},\n\nAs discussed, here is your ${template.title} to review and sign online:\n\n` +
          `${signUrl}\n\nIt takes about two minutes — read it through, type your name, and you're done. ` +
          `Reply to this email with any questions.\n\nBest,\nThe Implenix team\n\n--\n` +
          `${COMPANY.name} · ${COMPANY.postalAddress}\n`,
        html:
          `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">` +
          `<p>Hi ${escapeHtml(first)},</p>` +
          `<p>As discussed, here is your <strong>${escapeHtml(template.title)}</strong> to review and sign online:</p>` +
          `<p><a href="${signUrl}" style="background:#004e7a;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;display:inline-block;">Review &amp; sign</a></p>` +
          `<p>It takes about two minutes. Reply to this email with any questions.</p>` +
          `<p>Best,<br/>The Implenix team</p>` +
          `<p style="font-size:12px;color:#8a8a8a;">${COMPANY.name} · ${escapeHtml(COMPANY.postalAddress)}</p></div>`,
      });
      await db.from('messages').insert({
        workspace_id: contact.workspace_id,
        contact_id: contact.id,
        direction: 'outbound',
        resend_id: result.resendId,
        smtp_message_id: result.smtpMessageId,
        from_email: env.mailFrom.replace(/^.*<([^>]+)>.*$/, '$1'),
        to_email: contact.email,
        subject: `${template.title} — Implenix`,
        body_text: `Contract signing link: ${signUrl}`,
        status: 'sent',
        sent_at: DateTime.utc().toISO(),
      });
    } catch (err: any) {
      return reply.code(502).send({ error: 'send_failed', message: err?.message, contract_id: contract.id });
    }
    return reply.code(201).send({ id: contract.id, sign_url: signUrl });
  });

  /** Re-send the signing link. */
  app.post('/api/contracts/:id/remind', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { data: contract } = await db
      .from('contracts')
      .select('*, contacts(email, first_name, workspace_id)')
      .eq('id', (req.params as { id: string }).id)
      .maybeSingle();
    const contact = (contract as Record<string, any> | null)?.contacts;
    if (!contract || !contact || !assertWorkspace(user, contract.workspace_id, reply)) return;
    if (contract.status === 'signed' || contract.status === 'voided') {
      return reply.code(409).send({ error: 'not_pending' });
    }
    const signUrl = `${env.apiPublicUrl}/c/${contract.sign_token}`;
    await sendEmail({
      from: env.mailFrom,
      to: contact.email,
      subject: `Reminder: ${contract.title} awaiting your signature`,
      text:
        `Hi ${contact.first_name ?? 'there'},\n\nA quick reminder that your ${contract.title} is ready to sign:\n\n` +
        `${signUrl}\n\nBest,\nThe Implenix team\n\n--\n${COMPANY.name} · ${COMPANY.postalAddress}\n`,
      html:
        `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">` +
        `<p>Hi ${escapeHtml(contact.first_name ?? 'there')},</p>` +
        `<p>A quick reminder that your <strong>${escapeHtml(contract.title)}</strong> is ready to sign:</p>` +
        `<p><a href="${signUrl}">Review &amp; sign</a></p><p>Best,<br/>The Implenix team</p>` +
        `<p style="font-size:12px;color:#8a8a8a;">${COMPANY.name} · ${escapeHtml(COMPANY.postalAddress)}</p></div>`,
    });
    return { ok: true };
  });

  /** Void a contract (wrong template, renegotiated, etc.). */
  app.post('/api/contracts/:id/void', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { data: contract } = await db
      .from('contracts')
      .select('id, workspace_id, status')
      .eq('id', (req.params as { id: string }).id)
      .maybeSingle();
    if (!contract || !assertWorkspace(user, contract.workspace_id, reply)) return;
    if (contract.status === 'signed') return reply.code(409).send({ error: 'already_signed' });
    await db.from('contracts').update({ status: 'voided' }).eq('id', contract.id);
    return { ok: true };
  });

  // ---------------------------------------------------------------------
  // Public signing pages (tokenized — no login)
  // ---------------------------------------------------------------------

  app.get('/c/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const { data: contract } = await db
      .from('contracts')
      .select('*')
      .eq('sign_token', token)
      .maybeSingle();
    if (!contract || contract.status === 'voided') {
      return reply.code(404).type('text/html').send(contractPage('<p>Agreement not found.</p>'));
    }

    if (contract.status === 'sent') {
      await db
        .from('contracts')
        .update({ status: 'viewed', viewed_at: DateTime.utc().toISO() })
        .eq('id', contract.id);
    }

    if (contract.status === 'signed') {
      return reply.type('text/html').send(
        contractPage(
          `<div class="head"><strong>Implenix</strong><span class="badge">Signed</span></div>` +
            `<pre>${escapeHtml(contract.body_snapshot)}</pre>` +
            `<div class="sign"><p><strong>Signed by ${escapeHtml(contract.signer_name ?? '')}</strong>` +
            `${contract.signer_title ? ', ' + escapeHtml(contract.signer_title) : ''} on ` +
            `${DateTime.fromISO(contract.signed_at).toFormat('LLLL d, yyyy')}.</p>` +
            `<p class="muted">A copy has been emailed to you for your records.</p></div>`,
        ),
      );
    }

    return reply.type('text/html').send(
      contractPage(
        `<div class="head"><strong>Implenix</strong><span class="badge">Awaiting signature</span></div>` +
          `<pre>${escapeHtml(contract.body_snapshot)}</pre>` +
          `<form class="sign" method="post" action="/c/${token}/sign">` +
          `<h3 style="margin-top:0">Sign this agreement</h3>` +
          `<label for="signer_name">Full legal name</label>` +
          `<input type="text" id="signer_name" name="signer_name" required maxlength="200">` +
          `<label for="signer_title">Title (e.g. Practice Owner, Office Manager)</label>` +
          `<input type="text" id="signer_title" name="signer_title" required maxlength="200">` +
          `<div class="agree"><input type="checkbox" id="agree" name="agree" value="yes" required>` +
          `<label for="agree" style="font-weight:normal;margin:0">I have read this agreement and intend my typed name to be my legal electronic signature (U.S. ESIGN Act).</label></div>` +
          `<button type="submit">Sign agreement</button>` +
          `<p class="muted">Questions? Reply to the email that brought you here.</p></form>`,
      ),
    );
  });

  app.post('/c/:token/sign', async (req, reply) => {
    const { token } = req.params as { token: string };
    const body = (req.body ?? {}) as Record<string, string>;
    const signerName = String(body.signer_name ?? '').trim();
    const signerTitle = String(body.signer_title ?? '').trim();
    if (!signerName || body.agree !== 'yes') {
      return reply.code(400).type('text/html').send(contractPage('<p>Please fill in your name and tick the agreement box, then go back and try again.</p>'));
    }

    const { data: contract } = await db
      .from('contracts')
      .select('*, contacts(email, first_name, workspace_id)')
      .eq('sign_token', token)
      .maybeSingle();
    if (!contract || contract.status === 'voided') {
      return reply.code(404).type('text/html').send(contractPage('<p>Agreement not found.</p>'));
    }
    if (contract.status === 'signed') {
      return reply.redirect(`/c/${token}`);
    }

    const signedBody = contract.body_snapshot
      .replace(/\{\{\s*signer_name\s*\}\}/g, signerName)
      .replace(/\{\{\s*signer_title\s*\}\}/g, signerTitle);

    await db
      .from('contracts')
      .update({
        status: 'signed',
        signed_at: DateTime.utc().toISO(),
        signer_name: signerName,
        signer_title: signerTitle,
        signer_ip: req.ip,
        body_snapshot: signedBody,
      })
      .eq('id', contract.id);

    const contact = (contract as Record<string, any>).contacts;
    // Service agreement signed = client won.
    if (contract.kind === 'service_agreement' && contract.contact_id) {
      await db.from('contacts').update({ stage: 'closed_won' }).eq('id', contract.contact_id);
    }

    // Copy to the signer + notification to the owner.
    if (contact?.email) {
      await sendEmail({
        from: env.mailFrom,
        to: contact.email,
        subject: `Signed copy: ${contract.title}`,
        text:
          `Hi ${contact.first_name ?? 'there'},\n\nThank you — your ${contract.title} is signed. ` +
          `A copy is below for your records.\n\n----------------\n\n${signedBody}\n\n--\n` +
          `${COMPANY.name} · ${COMPANY.postalAddress}\n`,
        html:
          `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">` +
          `<p>Hi ${escapeHtml(contact.first_name ?? 'there')},</p>` +
          `<p>Thank you — your <strong>${escapeHtml(contract.title)}</strong> is signed. A copy is below for your records.</p>` +
          `<pre style="white-space:pre-wrap;background:#f6f8fa;padding:16px;border-radius:8px;font-size:12px;">${escapeHtml(signedBody)}</pre>` +
          `<p style="font-size:12px;color:#8a8a8a;">${COMPANY.name} · ${escapeHtml(COMPANY.postalAddress)}</p></div>`,
      }).catch(() => {});
    }
    const ownerEmail = await getWorkspaceOwnerEmail(contract.workspace_id).catch(() => null);
    if (ownerEmail) {
      await sendEmail({
        from: env.mailFrom,
        to: ownerEmail,
        subject: `✔ Signed: ${contract.title} — ${signerName}`,
        text:
          `${signerName}${signerTitle ? ` (${signerTitle})` : ''} just signed "${contract.title}".\n\n` +
          `View it in the dashboard: ${env.dashboardUrl}\n`,
        html:
          `<p><strong>${escapeHtml(signerName)}</strong>${signerTitle ? ` (${escapeHtml(signerTitle)})` : ''} just signed “${escapeHtml(contract.title)}”.</p>` +
          `<p><a href="${env.dashboardUrl}">Open the dashboard</a></p>`,
      }).catch(() => {});
    }

    return reply.redirect(`/c/${token}`);
  });
}
