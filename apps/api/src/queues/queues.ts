import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../env.js';

export const redis = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

/** Sends one sequence email to one lead. Job: { leadId: string } */
export const sendQueue = new Queue('send', { connection: redis });

/** Processes one inbound reply through the AI agent. Job: { inboundMessageId: string } */
export const replyQueue = new Queue('reply', { connection: redis });

/** Delayed booking reminders. Job: { appointmentId: string } */
export const reminderQueue = new Queue('reminder', { connection: redis });

/** Repeatable one-minute scheduler tick. */
export const tickQueue = new Queue('tick', { connection: redis });

export async function scheduleTick(): Promise<void> {
  await tickQueue.upsertJobScheduler('scheduler-tick', { every: 60_000 }, { name: 'tick' });
}

export const defaultJobOpts = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
