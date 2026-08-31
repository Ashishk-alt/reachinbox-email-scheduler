import { Queue } from 'bullmq';
import { redisConnectionOptions } from '../config/redis';

export const emailQueue = new Queue('email-queue', {
  ...redisConnectionOptions,

  defaultJobOptions: {
    attempts: 3,

    backoff: {
      type: 'exponential',
      delay: 5000,
    },

    removeOnComplete: false,
    removeOnFail: false,
  },
});

/**
 * Add an email to the BullMQ queue.
 *
 * A unique BullMQ job ID is generated for every queue attempt.
 * The database emailJobId remains the source of truth for the email.
 */
export async function enqueueEmail(
  emailJobId: string,
  delayMs: number = 0
) {
  const queueJobId = `email-${emailJobId}-${Date.now()}`;

  return await emailQueue.add(
    'send-email',
    {
      emailJobId,
    },
    {
      delay: Math.max(0, delayMs),
      jobId: queueJobId,
    }
  );
}
