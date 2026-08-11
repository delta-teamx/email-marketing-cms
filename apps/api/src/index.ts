import { buildServer } from './server.js';
import { startWorkers } from './queues/workers.js';
import { scheduleTick } from './queues/queues.js';
import { env } from './env.js';

const app = await buildServer();
const workers = startWorkers();
await scheduleTick();

await app.listen({ port: env.port, host: '0.0.0.0' });
app.log.info(`Implenix API listening on :${env.port}`);

async function shutdown() {
  app.log.info('Shutting down…');
  await Promise.allSettled([app.close(), ...workers.map((w) => w.close())]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
