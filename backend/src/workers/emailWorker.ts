import { Worker, Job } from 'bullmq';
import { redisConnectionOptions, redisClient } from '../config/redis';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { sendMail } from '../services/emailService';
import { sendSlackNotification } from '../services/slackService';
import { indexEmailJob } from '../services/searchService';
import { enqueueEmail } from '../queues/emailQueue';

/**
 * Core business logic for processing an email schedule job.
 * Extracted as a standalone function to enable clean unit testing.
 */
export async function processEmailJob(job: Job) {
  const { emailJobId } = job.data;
  if (!emailJobId) {
    logger.warn('Skipping job: No emailJobId provided in payload', job.id);
    return;
  }

  logger.info(`Processing job ${job.id} for EmailJob: ${emailJobId}`);

  // 1. Idempotency Check & Atomic State Transition
  const emailJob = await prisma.$transaction(async (tx) => {
    const record = await tx.emailJob.findUnique({
      where: { id: emailJobId },
      include: {
        campaign: {
          include: {
            sender: { select: { id: true, email: true, displayName: true } },
            user: {
              include: {
                slackConnection: { select: { accessToken: true, slackUserId: true } },
              },
            },
          },
        },
      },
    });

    if (!record) {
      return null;
    }

    // Skip if already sent or currently processing
    if (record.status === 'sent' || record.status === 'processing') {
      return { skip: true, record };
    }

    // Transition to processing atomically
    const updated = await tx.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'processing',
        attempts: { increment: 1 },
      },
      include: {
        campaign: {
          include: {
            sender: { select: { id: true, email: true, displayName: true } },
            user: {
              include: {
                slackConnection: { select: { accessToken: true, slackUserId: true } },
              },
            },
          },
        },
      },
    });

    return { skip: false, record: updated };
  });

  if (!emailJob) {
    logger.warn(`EmailJob ${emailJobId} not found in database.`);
    return;
  }

  if (emailJob.skip) {
    logger.info(`EmailJob ${emailJobId} is already in state: ${emailJob.record.status}. Skipping duplicate execution.`);
    return;
  }

  const jobRecord = emailJob.record;
  const campaign = jobRecord.campaign;
  const sender = campaign.sender;

  // 2. Minimum Send Delay Check
  const lastSendKey = `sender:last-send:${sender.id}`;
  const lastSendStr = await redisClient.get(lastSendKey);
  if (lastSendStr) {
    const lastSendTime = parseInt(lastSendStr, 10);
    const elapsed = Date.now() - lastSendTime;
    if (elapsed < env.MIN_EMAIL_DELAY_MS) {
      const additionalDelay = env.MIN_EMAIL_DELAY_MS - elapsed;
      logger.info(`Sender ${sender.email} is delay-limited. Re-scheduling job ${emailJobId} with +${additionalDelay}ms delay`);

      // Revert status to scheduled
      await prisma.emailJob.update({
        where: { id: emailJobId },
        data: { status: 'scheduled' },
      });

      // Re-enqueue
      await enqueueEmail(emailJobId, additionalDelay);
      return;
    }
  }

  // 3. Hourly Rate Limit Check
  const now = new Date();
  const hourWindow = now.toISOString().substring(0, 13).replace(/[-T]/g, ''); // YYYYMMDDHH format
  const rateLimitKey = `email-rate:${sender.id}:${hourWindow}`;

  const currentCount = await redisClient.incr(rateLimitKey);
  if (currentCount === 1) {
    await redisClient.expire(rateLimitKey, 7200);
  }

  const hourlyLimit = Math.min(env.MAX_EMAILS_PER_HOUR_PER_SENDER, campaign.hourlyLimit);

  if (currentCount > hourlyLimit) {
    logger.warn(`Sender ${sender.email} hit hourly limit (${hourlyLimit}). Rescheduling job ${emailJobId}`);

    // Revert count
    await redisClient.decr(rateLimitKey);

    // Revert status to scheduled
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: 'scheduled' },
    });

    // Compute delay until the start of next hour
    const nextHour = new Date();
    nextHour.setUTCHours(nextHour.getUTCHours() + 1, 0, 0, 0);
    const delayUntilNextHour = Math.max(1000, nextHour.getTime() - Date.now());

    // Re-enqueue
    await enqueueEmail(emailJobId, delayUntilNextHour);

    // Notify user on Slack
    const slackConn = campaign.user.slackConnection;
    if (slackConn) {
      const slackNotifyKey = `slack-notified:${sender.id}:${hourWindow}`;
      const alreadyNotified = await redisClient.get(slackNotifyKey);

      if (!alreadyNotified) {
        const message = `⚠️ *ReachInbox Rate Limit warning*: Sender *${sender.email}* has hit their hourly limit of ${hourlyLimit} emails. Pending emails are rescheduled.`;
        const notified = await sendSlackNotification(slackConn.accessToken, slackConn.slackUserId || '', message);
        if (notified) {
          await redisClient.set(slackNotifyKey, '1', 'EX', 3600);
        }
      }
    }

    return;
  }

  // 4. Send Email via Nodemailer Ethereal
  try {
    const result = await sendMail({
      from: `"${sender.displayName || sender.email}" <${sender.email}>`,
      to: jobRecord.recipient,
      subject: jobRecord.subject,
      body: jobRecord.body,
    });

    logger.info(`Email sent successfully for job ${emailJobId}. Message ID: ${result.messageId}`);

    // Update job to sent
    const sentJob = await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'sent',
        sentAt: new Date(),
        previewUrl: result.previewUrl || null,
      },
      include: {
        campaign: true,
      },
    });

    // Record last send timestamp
    await redisClient.set(lastSendKey, Date.now().toString());

    // Index sent job into Elasticsearch
    await indexEmailJob(sentJob);

  } catch (sendErr: any) {
    logger.error(`SMTP delivery failure for job ${emailJobId}`, sendErr);

    const failedJob = await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'failed',
        errorMessage: sendErr.message || 'SMTP Error',
      },
      include: {
        campaign: true,
      },
    });

    // Index failed state in Elasticsearch
    await indexEmailJob(failedJob);

    // Re-throw to trigger BullMQ retry backoff
    throw sendErr;
  }
}

export function startEmailWorker() {
  logger.info(`Starting email worker with concurrency: ${env.WORKER_CONCURRENCY}`);

  const worker = new Worker(
    'email-queue',
    processEmailJob,
    {
      ...redisConnectionOptions,
      concurrency: env.WORKER_CONCURRENCY,
    }
  );

  worker.on('completed', (job) => {
    logger.info(`Job completed: ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job failed: ${job?.id}`, err);
  });

  return worker;
}

if (require.main === module) {
  startEmailWorker();
}
