import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { exchangeSlackCode } from '../services/slackService';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

export async function connectSlack(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // Use the userId as the state parameter to verify and map the auth callback securely
  const state = req.user.id;
  const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${env.SLACK_CLIENT_ID}&scope=chat:write&redirect_uri=${env.SLACK_CALLBACK_URL}&state=${state}`;

  logger.info(`Redirecting user ${req.user.id} to Slack OAuth authorization page`);
  res.redirect(slackAuthUrl);
}

export async function slackCallbackHandler(req: Request, res: Response) {
  const code = req.query.code as string;
  const userId = req.query.state as string; // Retrieved from oauth 'state'

  if (!code || !userId) {
    logger.warn('Slack OAuth callback hit with missing code or state parameters.');
    return res.redirect(`${env.FRONTEND_URL}?slack=missing_params`);
  }

  try {
    const { accessToken, slackUserId } = await exchangeSlackCode(code);

    // Upsert the SlackConnection record linked to the User
    await prisma.slackConnection.upsert({
      where: { userId },
      create: {
        userId,
        slackUserId,
        accessToken,
      },
      update: {
        slackUserId,
        accessToken,
        updatedAt: new Date(),
      },
    });

    logger.info(`Slack successfully connected and token stored for user: ${userId}`);
    res.redirect(`${env.FRONTEND_URL}?slack=connected`);
  } catch (err: any) {
    logger.error('Slack OAuth callback processing failed', err);
    res.redirect(`${env.FRONTEND_URL}?slack=failed`);
  }
}

export async function disconnectSlack(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    await prisma.slackConnection.delete({
      where: { userId: req.user.id },
    });

    logger.info(`Slack disconnected for user: ${req.user.id}`);
    res.json({
      success: true,
      message: 'Slack disconnected successfully',
    });
  } catch (err: any) {
    // If connection doesn't exist, we still want to report success
    logger.warn(`Attempted to delete non-existent Slack connection for user ${req.user.id}`, err);
    res.json({
      success: true,
      message: 'Slack was not connected or already disconnected',
    });
  }
}

export async function getSlackStatus(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const connection = await prisma.slackConnection.findUnique({
      where: { userId: req.user.id },
      select: {
        connectedAt: true,
        slackUserId: true,
      },
    });

    res.json({
      success: true,
      data: {
        connected: !!connection,
        connection: connection || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}
