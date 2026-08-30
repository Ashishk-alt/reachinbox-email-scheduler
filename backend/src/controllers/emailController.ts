
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

// Zod validation schema for scheduling payload
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
    // 1. Validate sender ownership
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

    // Ensure start time is not too far in the past
    // Allow a 60-second window for clock drift
    const minStartTime = new Date(Date.now() - 60000);

    if (startTime < minStartTime) {
      return res.status(400).json({
        success: false,
        message: 'Start time cannot be in the past',
      });
    }

    // 2. Insert EmailCampaign and EmailJobs into PostgreSQL
    //    in a single transaction
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
          // Calculate delayed schedule time for each recipient
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

        // Bulk create EmailJobs
        await tx.emailJob.createMany({
          data: jobData,
        });

        // Query jobs back to get their IDs
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
    // 3. INDEX SCHEDULED EMAILS INTO ELASTICSEARCH
    // ============================================================
    //
    // The Elasticsearch indexEmailJob() function expects:
    //
    // emailJob.campaign.senderId
    // emailJob.campaign.userId
    //
    // The campaign returned above contains both values, so we
    // attach the campaign object to each job before indexing.
    //
    // This ensures scheduled emails are searchable in Elasticsearch
    // immediately after they are created.
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
        // indexEmailJob already handles its own errors, but this
        // protects the scheduling flow if its implementation changes.
        logger.error(
          `Failed to index scheduled email job ${job.id} in Elasticsearch`,
          err
        );
      }
    });

    await Promise.all(indexingPromises);

    // ============================================================
    // 4. ENQUEUE TO BULLMQ AFTER DATABASE COMMIT
    // ============================================================
    //
    // This prevents the worker from trying to process a job
    // before the PostgreSQL transaction has completed.
    //
    // We also update each job with its BullMQ job ID.
    // ============================================================

    const enqueuePromises = jobs.map(async (job) => {
      try {
        const delayMs = Math.max(
          0,
          job.scheduledAt.getTime() - Date.now()
        );

        const bullJob = await enqueueEmail(
          job.id,
          delayMs
        );

        // Update database with active BullMQ Job ID
        await prisma.emailJob.update({
          where: {
            id: job.id,
          },
          data: {
            bullJobId: bullJob.id,
          },
        });

        logger.info(
          `Email job ${job.id} enqueued to BullMQ with delay ${delayMs}ms.`
        );
      } catch (err: any) {
        logger.error(
          `Error enqueuing job ${job.id} into BullMQ`,
          err
        );
      }
    });

    await Promise.all(enqueuePromises);

    // 5. Return successful response
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
      'Failed to schedule email campaign',
      err
    );

    return res.status(500).json({
      success: false,
      message:
        'Failed to schedule campaign: ' + err.message,
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
      message: err.message,
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
      message: err.message,
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
      message: err.message,
    });
  }
}