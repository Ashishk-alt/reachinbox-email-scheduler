import { Queue } from 'bullmq';
import { redisConnectionOptions } from '../config/redis';

export const emailQueue = new Queue('email-queue', {
  ...redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // Wait 5 seconds before retrying failed jobs
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

export async function enqueueEmail(emailJobId: string, delayMs: number) {
  return await emailQueue.add(
    'send-email',
    { emailJobId },
    {
      delay: delayMs,
      jobId: emailJobId, // Enforce queue-level uniqueness/idempotency
    }
  );
}
