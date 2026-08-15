import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { verifyUnsubscribeToken } from '../services/unsubscribe.js';
import { suppress } from '../services/suppression.js';

const PAGE = (msg: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Implenix</title>` +
  `<meta name="robots" content="noindex"></head>` +
  `<body style="font-family:Arial,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#1a2233;">` +
  `<h2>Implenix</h2><p>${msg}</p></body></html>`;

export function unsubscribeRoutes(app: FastifyInstance): void {
  const handle = async (req: any, reply: any) => {
    const { token } = req.params as { token: string };
    const contactId = verifyUnsubscribeToken(token);
    if (!contactId) return reply.code(404).type('text/html').send(PAGE('Link not recognized.'));

    const { data: contact } = await db
      .from('contacts')
      .select('id, email, workspace_id')
      .eq('id', contactId)
      .maybeSingle();
    if (contact) {
      await suppress(contact.email, contact.workspace_id, 'unsubscribe');
      await db.from('contacts').update({ stage: 'dnc' }).eq('id', contactId);
    }
    return reply
      .type('text/html')
      .send(PAGE("You've been unsubscribed. You won't receive further emails from us."));
  };

  // GET for humans clicking the footer link; POST for RFC 8058 one-click.
  app.get('/u/:token', handle);
  app.post('/u/:token', handle);
}
