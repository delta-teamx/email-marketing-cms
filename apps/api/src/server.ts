import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';
import { bookingRoutes } from './routes/booking.js';
import { webhookRoutes } from './routes/webhooks.js';
import { unsubscribeRoutes } from './routes/unsubscribe.js';
import { campaignRoutes } from './routes/campaigns.js';
import { agentActionRoutes } from './routes/agentActions.js';

export async function buildServer() {
  const app = Fastify({ logger: true, trustProxy: true });

  // Keep the raw body around for Svix (Resend webhook) signature checks.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, body === '' ? {} : JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(cors, {
    origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  app.get('/health', async () => ({ ok: true }));

  bookingRoutes(app);
  webhookRoutes(app);
  unsubscribeRoutes(app);
  campaignRoutes(app);
  agentActionRoutes(app);

  return app;
}
