import { Worker } from 'bullmq';
import { redis } from './queues.js';
import { sendFollowupStep } from '../services/followups.js';
import { triageInbound } from '../agent/classify.js';

export function startWorkers(): Worker[] {
  const followups = new Worker(
    'followup',
    async (job) => sendFollowupStep(job.data.appointmentId as string, job.data.stepId as string),
    { connection: redis, concurrency: 3 },
  );

  const replies = new Worker(
    'reply',
    async (job) => triageInbound(job.data.inboundMessageId as string),
    { connection: redis, concurrency: 3 },
  );

  for (const w of [followups, replies]) {
    w.on('failed', (job, err) => {
      console.error(`[worker:${w.name}] job ${job?.id} failed:`, err.message);
    });
  }
  return [followups, replies];
}
