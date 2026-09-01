import { Response } from 'express';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { enqueueEmail } from '../queues/emailQueue';
import {
  searchEmails,
  indexEmailJob,
} from '../services/searchService';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { z } from 'zod';

const scheduleSchema = z.object({
  senderId: z.string().uuid('Invalid senderId'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  recipients: z
    .array(z.string().email('Invalid email address'))
    .min(1, 'At least one recipient is required'),
  startTime: z.string().transform((str) => new Date(str)),
  delayBetweenEmails: z
    .coerce
    .number()
    .int()
    .nonnegative('Delay must be a positive integer or zero'),
  hourlyLimit: z
    .coerce
    .number()
    .int()
    .positive('Hourly limit must be a positive integer'),
});

export async function scheduleEmails(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  const parsedBody = scheduleSchema.safeParse(req.body);

  if (!parsedBody.success) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: parsedBody.error.format(),
    });
  }

  const {
    senderId,
    subject,
    body,
    recipients,
    startTime,
    delayBetweenEmails,
    hourlyLimit,
  } = parsedBody.data;

  try {
    const sender = await prisma.sender.findFirst({
      where: {
        id: senderId,
        userId: req.user.id,
      },
    });

    if (!sender) {
      return res.status(403).json({
        success: false,
        message:
          'Forbidden: You do not own the selected sender address',
      });
    }

    const minStartTime = new Date(Date.now() - 60000);

    if (startTime < minStartTime) {
      return res.status(400).json({
        success: false,
        message: 'Start time cannot be in the past',
      });
    }

    // ============================================================
    // 1. CREATE CAMPAIGN + EMAIL JOBS
    // ============================================================

    const { campaign, jobs } = await prisma.$transaction(
      async (tx) => {
        const newCampaign = await tx.emailCampaign.create({
          data: {
            userId: req.user!.id,
            senderId,
            subject,
            body,
            startTime,
            delayBetweenEmails,
            hourlyLimit,
          },
        });

        const jobData = recipients.map((recipient, index) => {
          const scheduledTime = new Date(
            startTime.getTime() +
              index * delayBetweenEmails
          );

          return {
            campaignId: newCampaign.id,
            recipient,
            subject,
            body,
            scheduledAt: scheduledTime,
            status: 'scheduled' as const,
          };
        });

        await tx.emailJob.createMany({
          data: jobData,
        });

        const createdJobs = await tx.emailJob.findMany({
          where: {
            campaignId: newCampaign.id,
          },
          orderBy: {
            scheduledAt: 'asc',
          },
        });

        return {
          campaign: newCampaign,
          jobs: createdJobs,
        };
      }
    );

    logger.info(
      `Created EmailCampaign ${campaign.id} with ${jobs.length} jobs in PostgreSQL.`
    );

    // ============================================================
    // 2. ENQUEUE EVERY JOB INTO BULLMQ
    // ============================================================

    const enqueuePromises = jobs.map(async (job) => {
      const delayMs = Math.max(
        0,
        job.scheduledAt.getTime() - Date.now()
      );

      try {
        logger.info(
          `Attempting to enqueue EmailJob ${job.id} into BullMQ...`
        );

        const bullJob = await enqueueEmail(
          job.id,
          delayMs
        );

        if (!bullJob || !bullJob.id) {
          throw new Error(
            'BullMQ did not return a valid job ID'
          );
        }

        await prisma.emailJob.update({
          where: {
            id: job.id,
          },
          data: {
            bullJobId: bullJob.id,
          },
        });

        logger.info(
          `✅ Email job ${job.id} enqueued to BullMQ. BullMQ ID: ${bullJob.id}. Delay: ${delayMs}ms`
        );

        return {
          job,
          bullJob,
        };
      } catch (err: any) {
        logger.error(
          `❌ Error enqueuing job ${job.id} into BullMQ: ${
            err?.message || err
          }`
        );

        try {
          await prisma.emailJob.update({
            where: {
              id: job.id,
            },
            data: {
              status: 'failed',
            },
          });
        } catch (dbError: any) {
          logger.error(
            `❌ Failed to mark EmailJob ${job.id} as failed: ${
              dbError?.message || dbError
            }`
          );
        }

        throw err;
      }
    });

    let enqueueResults;

    try {
      enqueueResults = await Promise.all(
        enqueuePromises
      );
    } catch (err: any) {
      logger.error(
        `❌ BullMQ enqueue failed for campaign ${campaign.id}: ${
          err?.message || err
        }`
      );

      return res.status(500).json({
        success: false,
        message:
          'Campaign was created, but one or more emails could not be added to the email queue.',
        error: err?.message || String(err),
        data: {
          campaignId: campaign.id,
        },
      });
    }

    // ============================================================
    // 3. INDEX INTO ELASTICSEARCH
    //
    // Elasticsearch is NOT part of the critical queue path.
    // A search-index failure must not prevent email delivery.
    // ============================================================

    const indexingPromises = jobs.map(async (job) => {
      try {
        await indexEmailJob({
          ...job,
          campaign,
        });

        logger.info(
          `Scheduled email job ${job.id} indexed in Elasticsearch.`
        );
      } catch (err: any) {
        logger.error(
          `Failed to index scheduled email job ${job.id} in Elasticsearch: ${
            err?.message || err
          }`
        );
      }
    });

    await Promise.all(indexingPromises);

    logger.info(
      `🎉 Campaign ${campaign.id} successfully scheduled. ${enqueueResults.length} BullMQ jobs created.`
    );

    // ============================================================
    // 4. RESPONSE
    // ============================================================

    return res.status(201).json({
      success: true,
      message: `${jobs.length} emails scheduled successfully`,
      data: {
        campaignId: campaign.id,
        recipientCount: jobs.length,
      },
    });
  } catch (err: any) {
    logger.error(
      `❌ Failed to schedule email campaign: ${
        err?.message || err
      }`
    );

    return res.status(500).json({
      success: false,
      message:
        'Failed to schedule campaign: ' +
        (err?.message || String(err)),
    });
  }
}

export async function getScheduled(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  const page =
    parseInt(req.query.page as string, 10) || 1;

  const limit =
    parseInt(req.query.limit as string, 10) || 10;

  const skip = (page - 1) * limit;

  try {
    const [jobs, total] = await prisma.$transaction([
      prisma.emailJob.findMany({
        where: {
          campaign: {
            userId: req.user.id,
          },
          status: {
            in: ['scheduled', 'processing', 'failed'],
          },
        },
        orderBy: {
          scheduledAt: 'asc',
        },
        skip,
        take: limit,
        include: {
          campaign: {
            select: {
              sender: {
                select: {
                  email: true,
                },
              },
            },
          },
        },
      }),

      prisma.emailJob.count({
        where: {
          campaign: {
            userId: req.user.id,
          },
          status: {
            in: ['scheduled', 'processing', 'failed'],
          },
        },
      }),
    ]);

    const normalizedJobs = jobs.map((job) => ({
      ...job,
      status: job.status === 'processing' ? 'scheduled' : job.status,
    }));

    return res.json({
      success: true,
      data: normalizedJobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || String(err),
    });
  }
}

export async function getSent(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  const page =
    parseInt(req.query.page as string, 10) || 1;

  const limit =
    parseInt(req.query.limit as string, 10) || 10;

  const skip = (page - 1) * limit;

  try {
    const [jobs, total] = await prisma.$transaction([
      prisma.emailJob.findMany({
        where: {
          campaign: {
            userId: req.user.id,
          },
          status: 'sent',
        },
        orderBy: {
          sentAt: 'desc',
        },
        skip,
        take: limit,
        include: {
          campaign: {
            select: {
              sender: {
                select: {
                  email: true,
                },
              },
            },
          },
        },
      }),

      prisma.emailJob.count({
        where: {
          campaign: {
            userId: req.user.id,
          },
          status: 'sent',
        },
      }),
    ]);

    return res.json({
      success: true,
      data: jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || String(err),
    });
  }
}

export async function searchEmailsController(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  const query = req.query.q as string;

  if (!query) {
    return res.status(400).json({
      success: false,
      message: 'Query parameter "q" is required',
    });
  }

  try {
    const results = await searchEmails(
      query,
      req.user.id
    );

    return res.json({
      success: true,
      data: results,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || String(err),
    });
  }
}