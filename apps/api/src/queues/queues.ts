import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../env.js';

export const redis = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

/**
 * Sends one follow-up step email for one appointment.
 * Job: { appointmentId: string, stepId: string }
 * jobId convention: fu:<appointmentId>:<stepId> (used for cancellation)
 */
export const followupQueue = new Queue('followup', { connection: redis });

/** Processes one inbound reply through the triage agent. Job: { inboundMessageId } */
export const replyQueue = new Queue('reply', { connection: redis });

export function followupJobId(appointmentId: string, stepId: string): string {
  return `fu:${appointmentId}:${stepId}`;
}

export const defaultJobOpts = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
