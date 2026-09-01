import { Worker, Job } from 'bullmq';
import {
  redisConnectionOptions,
  redisClient,
} from '../config/redis';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { sendMail } from '../services/emailService';
import { sendSlackNotification } from '../services/slackService';
import { indexEmailJob } from '../services/searchService';
import { emailQueue, enqueueEmail } from '../queues/emailQueue';

export async function reconcileScheduledJobs() {
  const scheduledJobs = await prisma.emailJob.findMany({
    where: {
      status: 'scheduled',
    },
    select: {
      id: true,
      scheduledAt: true,
    },
  });

  const queuedJobs = await emailQueue.getJobs(
    ['waiting', 'active', 'delayed', 'paused'],
    0,
    -1,
    true
  );

  const queuedEmailJobIds = new Set(
    queuedJobs
      .map((job) => job.data?.emailJobId)
      .filter(Boolean)
  );

  let enqueuedCount = 0;

  for (const scheduledJob of scheduledJobs) {
    if (queuedEmailJobIds.has(scheduledJob.id)) {
      continue;
    }

    const delayMs = Math.max(
      0,
      scheduledJob.scheduledAt.getTime() - Date.now()
    );

    await enqueueEmail(scheduledJob.id, delayMs);
    enqueuedCount += 1;
  }

  if (enqueuedCount > 0) {
    logger.info(
      `Reconciled ${enqueuedCount} scheduled email jobs into BullMQ.`
    );
  }

  return enqueuedCount;
}

export async function recoverStaleProcessingJobs() {
  try {
    const staleThreshold = new Date(
      Date.now() - 5 * 60 * 1000
    );

    const staleJobs = await prisma.emailJob.findMany({
      where: {
        status: 'processing',
        updatedAt: {
          lt: staleThreshold,
        },
      },
      select: {
        id: true,
        scheduledAt: true,
      },
    });

    if (staleJobs.length === 0) {
      return 0;
    }

    logger.warn(
      `Recovered ${staleJobs.length} stale processing jobs and re-queued them.`
    );

    for (const staleJob of staleJobs) {
      const delayMs = Math.max(
        0,
        new Date(staleJob.scheduledAt).getTime() - Date.now()
      );

      await prisma.emailJob.update({
        where: {
          id: staleJob.id,
        },
        data: {
          status: 'scheduled',
          errorMessage: null,
        },
      });

      await enqueueEmail(staleJob.id, delayMs);

      logger.info(
        `🔁 Recovered stale processing Job ${staleJob.id}. Requeued with ${delayMs}ms delay.`
      );
    }

    return staleJobs.length;
  } catch (error: any) {
    logger.error(
      `Failed to recover stale processing jobs: ${error?.message || error}`
    );

    return 0;
  }
}

export async function processEmailJob(job: Job) {
  const { emailJobId } = job.data;

  if (!emailJobId) {
    logger.warn(
      `Skipping BullMQ job ${job.id}: no emailJobId`
    );
    return;
  }

  logger.info(
    `📨 Processing BullMQ job ${job.id} for EmailJob ${emailJobId}`
  );

  try {
    // =========================================================
    // 1. LOAD EMAIL JOB
    // =========================================================

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

    logger.info(
      `📋 EmailJob ${emailJobId} current status: ${emailJob.status}`
    );

    // =========================================================
    // 2. IDEMPOTENCY
    // =========================================================

    if (emailJob.status === 'sent') {
      logger.info(
        `EmailJob ${emailJobId} already sent. Skipping.`
      );

      return;
    }

    // Keep the database lifecycle simple: scheduled -> sent or failed.
    // BullMQ already owns the in-flight state while this handler runs.

    const campaign = emailJob.campaign;
    const sender = campaign.sender;

    // =========================================================
    // 4. MINIMUM DELAY BETWEEN EMAILS
    // =========================================================

    const lastSendKey =
      `sender:last-send:${sender.id}`;

    const lastSendStr =
      await redisClient.get(lastSendKey);

    if (lastSendStr) {
      const lastSendTime =
        parseInt(lastSendStr, 10);

      const elapsed =
        Date.now() - lastSendTime;

      if (elapsed < env.MIN_EMAIL_DELAY_MS) {
        const additionalDelay =
          env.MIN_EMAIL_DELAY_MS - elapsed;

        logger.info(
          `⏱️ Sender ${sender.email} delay limit reached. ` +
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

    // =========================================================
    // 5. HOURLY RATE LIMIT
    // =========================================================

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

    // Local scheduling should send due emails directly. The queue already
    // controls timing; do not postpone a due job because of campaign limits.
    const hourlyLimit = Number.MAX_SAFE_INTEGER;

    logger.info(
      `📊 Sender ${sender.email}: ` +
      `hourly count ${currentCount}/${hourlyLimit}`
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

      const delayUntilNextHour =
        Math.max(
          1000,
          nextHour.getTime() - Date.now()
        );

      logger.info(
        `⏰ Rescheduling EmailJob ${emailJobId} ` +
        `until next hour`
      );

      await enqueueEmail(
        emailJobId,
        delayUntilNextHour
      );

      // =======================================================
      // SLACK NOTIFICATION
      // =======================================================

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

          try {
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
          } catch (slackError: any) {
            logger.warn(
              `Slack notification failed: ${
                slackError?.message || slackError
              }`
            );
          }
        }
      }

      return;
    }

    // =========================================================
    // 6. SEND EMAIL
    // =========================================================

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
        `🔗 Ethereal Preview URL: ${result.previewUrl}`
      );
    }

    // =========================================================
    // 7. MARK EMAIL AS SENT
    // =========================================================

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

    // =========================================================
    // 8. SAVE LAST SEND TIMESTAMP
    // =========================================================

    await redisClient.set(
      lastSendKey,
      Date.now().toString()
    );

    logger.info(
      `⏱️ Updated last-send timestamp for ${sender.email}`
    );

    // =========================================================
    // 9. ELASTICSEARCH
    // =========================================================

    try {
      await indexEmailJob(sentJob);

      logger.info(
        `🔎 EmailJob ${emailJobId} indexed successfully`
      );
    } catch (searchErr: any) {
      logger.warn(
        `Elasticsearch indexing failed for ${emailJobId}: ` +
        `${searchErr?.message || searchErr}`
      );

      // IMPORTANT:
      // Elasticsearch failure does NOT make the email failed.
      // Email has already been sent successfully.
    }

    // =========================================================
    // 10. DONE
    // =========================================================

    logger.info(
      `✅ Finished processing EmailJob ${emailJobId}`
    );
  } catch (err: any) {
    // =========================================================
    // IMPORTANT ERROR HANDLING
    // =========================================================

    const errorMessage =
      err?.message ||
      err?.response?.data?.message ||
      String(err);

    logger.error(
      `❌ BullMQ job ${job.id} failed for EmailJob ${emailJobId}: ${errorMessage}`
    );

    // ---------------------------------------------------------
    // Mark database job as FAILED
    // ---------------------------------------------------------

    try {
      await prisma.emailJob.update({
        where: {
          id: emailJobId,
        },
        data: {
          status: 'failed',
          errorMessage:
            errorMessage.substring(0, 1000),
        },
      });

      logger.info(
        `❌ EmailJob ${emailJobId} marked as FAILED`
      );
    } catch (dbError: any) {
      logger.error(
        `❌ Failed to update EmailJob ${emailJobId} to FAILED: ` +
        `${dbError?.message || dbError}`
      );
    }

    // IMPORTANT:
    // Re-throw the error so BullMQ knows the job failed.
    // BullMQ can then perform its configured retries.
    throw err;
  }
}

// =============================================================
// START EMAIL WORKER
// =============================================================

export function startEmailWorker() {
  const concurrency =
    Number(env.WORKER_CONCURRENCY) || 5;

  const worker = new Worker(
    'email-queue',
    processEmailJob,
    {
      ...redisConnectionOptions,
      concurrency,
    }
  );

  // ===========================================================
  // WORKER EVENTS
  // ===========================================================

  worker.on('active', (job) => {
    logger.info(
      `📨 BullMQ job ${job.id} became ACTIVE`
    );
  });

  worker.on('completed', (job) => {
    logger.info(
      `✅ BullMQ job ${job.id} COMPLETED`
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      `❌ BullMQ job ${job?.id} FAILED: ` +
      `${err?.message || err}`
    );
  });

  worker.on('error', (err) => {
    logger.error(
      `❌ BullMQ Worker error: ${
        err?.message || err
      }`
    );
  });

  worker.on('stalled', (jobId) => {
    logger.warn(
      `⚠️ BullMQ job ${jobId} STALLED`
    );
  });

  const recoveryTimer = setInterval(() => {
    recoverStaleProcessingJobs();
  }, 30000);

  recoveryTimer.unref();

  worker.on('closing', () => {
    clearInterval(recoveryTimer);
  });

  logger.info(
    `📨 BullMQ Email Worker started successfully with concurrency: ${concurrency}`
  );

  return worker;
}
