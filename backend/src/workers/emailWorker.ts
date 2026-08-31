import { Worker, Job } from 'bullmq';
import { redisConnectionOptions, redisClient } from '../config/redis';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { sendMail } from '../services/emailService';
import { sendSlackNotification } from '../services/slackService';
import { indexEmailJob } from '../services/searchService';
import { enqueueEmail } from '../queues/emailQueue';

export async function processEmailJob(job: Job) {
  const { emailJobId } = job.data;

  if (!emailJobId) {
    logger.warn(`Skipping BullMQ job ${job.id}: no emailJobId`);
    return;
  }

  logger.info(
    `📨 Processing BullMQ job ${job.id} for EmailJob ${emailJobId}`
  );

  let jobRecord: any;

  try {
    // ---------------------------------------------------------
    // 1. Load EmailJob
    // ---------------------------------------------------------

    const emailJob = await prisma.emailJob.findUnique({
      where: {
        id: emailJobId,
      },
      include: {
        campaign: {
          include: {
            sender: {
              select: {
                id: true,
                email: true,
                displayName: true,
              },
            },
            user: {
              include: {
                slackConnection: {
                  select: {
                    accessToken: true,
                    slackUserId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!emailJob) {
      logger.warn(
        `EmailJob ${emailJobId} not found in database`
      );
      return;
    }

    jobRecord = emailJob;

    logger.info(
      `📋 EmailJob ${emailJobId} current status: ${emailJob.status}`
    );

    // ---------------------------------------------------------
    // 2. Idempotency
    // ---------------------------------------------------------

    if (emailJob.status === 'sent') {
      logger.info(
        `EmailJob ${emailJobId} already sent. Skipping.`
      );
      return;
    }

    // ---------------------------------------------------------
    // 3. Mark as processing
    // ---------------------------------------------------------

    await prisma.emailJob.update({
      where: {
        id: emailJobId,
      },
      data: {
        status: 'processing',
        attempts: {
          increment: 1,
        },
      },
    });

    logger.info(
      `🔄 EmailJob ${emailJobId} marked as PROCESSING`
    );

    const campaign = emailJob.campaign;
    const sender = campaign.sender;

    // ---------------------------------------------------------
    // 4. Minimum delay between emails
    // ---------------------------------------------------------

    const lastSendKey = `sender:last-send:${sender.id}`;

    const lastSendStr = await redisClient.get(lastSendKey);

    if (lastSendStr) {
      const lastSendTime = parseInt(lastSendStr, 10);

      const elapsed = Date.now() - lastSendTime;

      if (elapsed < env.MIN_EMAIL_DELAY_MS) {
        const additionalDelay =
          env.MIN_EMAIL_DELAY_MS - elapsed;

        logger.info(
          `⏳ Sender ${sender.email} delay limit reached. ` +
          `Rescheduling ${emailJobId} after ${additionalDelay}ms`
        );

        await prisma.emailJob.update({
          where: {
            id: emailJobId,
          },
          data: {
            status: 'scheduled',
          },
        });

        await enqueueEmail(
          emailJobId,
          additionalDelay
        );

        return;
      }
    }

    // ---------------------------------------------------------
    // 5. Hourly rate limit
    // ---------------------------------------------------------

    const now = new Date();

    const hourWindow = now
      .toISOString()
      .substring(0, 13)
      .replace(/[-T]/g, '');

    const rateLimitKey =
      `email-rate:${sender.id}:${hourWindow}`;

    const currentCount =
      await redisClient.incr(rateLimitKey);

    if (currentCount === 1) {
      await redisClient.expire(
        rateLimitKey,
        7200
      );
    }

    const hourlyLimit = Math.min(
      env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      campaign.hourlyLimit
    );

    if (currentCount > hourlyLimit) {
      logger.warn(
        `⚠️ Sender ${sender.email} reached hourly limit ${hourlyLimit}`
      );

      await redisClient.decr(rateLimitKey);

      await prisma.emailJob.update({
        where: {
          id: emailJobId,
        },
        data: {
          status: 'scheduled',
        },
      });

      const nextHour = new Date();

      nextHour.setUTCHours(
        nextHour.getUTCHours() + 1,
        0,
        0,
        0
      );

      const delayUntilNextHour = Math.max(
        1000,
        nextHour.getTime() - Date.now()
      );

      await enqueueEmail(
        emailJobId,
        delayUntilNextHour
      );

      // Slack notification
      const slackConn =
        campaign.user.slackConnection;

      if (slackConn) {
        const slackNotifyKey =
          `slack-notified:${sender.id}:${hourWindow}`;

        const alreadyNotified =
          await redisClient.get(
            slackNotifyKey
          );

        if (!alreadyNotified) {
          const message =
            `⚠️ *ReachInbox Rate Limit warning*\n` +
            `Sender *${sender.email}* has reached ` +
            `the hourly limit of ${hourlyLimit} emails.\n` +
            `Pending emails have been rescheduled.`;

          const notified =
            await sendSlackNotification(
              slackConn.accessToken,
              slackConn.slackUserId || '',
              message
            );

          if (notified) {
            await redisClient.set(
              slackNotifyKey,
              '1',
              'EX',
              3600
            );
          }
        }
      }

      return;
    }

    // ---------------------------------------------------------
    // 6. SEND EMAIL
    // ---------------------------------------------------------

    logger.info(
      `📤 Sending email for EmailJob ${emailJobId}`
    );

    logger.info(
      `From: ${sender.email}`
    );

    logger.info(
      `To: ${emailJob.recipient}`
    );

    logger.info(
      `Subject: ${emailJob.subject}`
    );

    const result = await sendMail({
      from:
        `"${sender.displayName || sender.email}" <${sender.email}>`,
      to: emailJob.recipient,
      subject: emailJob.subject,
      body: emailJob.body,
    });

    logger.info(
      `✅ SMTP accepted email ${emailJobId}`
    );

    logger.info(
      `Message ID: ${result.messageId}`
    );

    if (result.previewUrl) {
      logger.info(
        `Ethereal Preview URL: ${result.previewUrl}`
      );
    }

    // ---------------------------------------------------------
    // 7. Mark SENT
    // ---------------------------------------------------------

    const sentJob =
      await prisma.emailJob.update({
        where: {
          id: emailJobId,
        },
        data: {
          status: 'sent',
          sentAt: new Date(),
          previewUrl:
            result.previewUrl || null,
          errorMessage: null,
        },
        include: {
          campaign: true,
        },
      });

    logger.info(
      `🎉 EmailJob ${emailJobId} successfully marked as SENT`
    );

    // ---------------------------------------------------------
    // 8. Save last-send timestamp
    // ---------------------------------------------------------

    await redisClient.set(
      lastSendKey,
      Date.now().toString()
    );

    // ---------------------------------------------------------
    // 9. Elasticsearch
    // ---------------------------------------------------------

    try {
      await indexEmailJob(sentJob);

      logger.info(
        `🔎 EmailJob ${emailJobId} indexed successfully`
      );
    } catch (searchErr: any) {
      // Search failure should NOT turn a successfully
      // sent email into a failed email.
      logger.warn(
        `Elasticsearch indexing failed for ${emailJobId}: ` +
        `${searchErr?.message || searchErr}`
      );
    }

  } catch (err: any) {

    logger.error(
      `❌ Email worker failed for EmailJob ${emailJobId}:`,
      err
    );

    logger.error(
      `Error message: ${err?.message || 'Unknown error'}`
    );

    // ---------------------------------------------------------
    // Mark FAILED
    // ---------------------------------------------------------

    try {
      await prisma.emailJob.update({
        where: {
          id: emailJobId,
        },
        data: {
          status: 'failed',
          errorMessage:
            err?.message || 'Email processing failed',
        },
      });

      logger.info(
        `EmailJob ${emailJobId} marked as FAILED`
      );
    } catch (dbErr: any) {
      logger.error(
        `Could not update EmailJob ${emailJobId} to FAILED`,
        dbErr
      );
    }

    throw err;
  }
}

// =============================================================
// START WORKER
// =============================================================

export function startEmailWorker() {
  logger.info(
    `Starting email worker with concurrency: ${env.WORKER_CONCURRENCY}`
  );

  const worker = new Worker(
    'email-queue',
    processEmailJob,
    {
      ...redisConnectionOptions,
      concurrency: env.WORKER_CONCURRENCY,
    }
  );

  worker.on('ready', () => {
    logger.info(
      '🟢 BullMQ worker is connected and ready'
    );
  });

  worker.on('active', (job) => {
    logger.info(
      `▶️ BullMQ job ${job.id} became ACTIVE`
    );
  });

  worker.on('completed', (job) => {
    logger.info(
      `✅ BullMQ job ${job.id} COMPLETED`
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      `❌ BullMQ job ${job?.id} FAILED`,
      err
    );
  });

  worker.on('error', (err) => {
    logger.error(
      '❌ BullMQ worker error',
      err
    );
  });

  return worker;
}

if (require.main === module) {
  startEmailWorker();
}

