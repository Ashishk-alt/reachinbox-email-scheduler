import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { exchangeSlackCode } from '../services/slackService';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

export async function connectSlack(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  try {
    /*
     * Use the authenticated application user as OAuth state.
     */
    const state = req.user.id;

    /*
     * IMPORTANT:
     *
     * We intentionally DO NOT send redirect_uri here.
     *
     * Slack will use the Redirect URL configured in:
     *
     * Slack App
     * -> OAuth & Permissions
     * -> Redirect URLs
     *
     * This prevents the bad_redirect_uri mismatch during
     * oauth.v2.access.
     */

    const params = new URLSearchParams();

    params.append('client_id', env.SLACK_CLIENT_ID);
    params.append('scope', 'chat:write');
    params.append('state', state);

    const slackAuthUrl =
      `https://slack.com/oauth/v2/authorize?${params.toString()}`;

    logger.info(
      `Slack OAuth redirect URI configured on server: ${env.SLACK_CALLBACK_URL}`
    );

    logger.info(
      `Redirecting user ${req.user.id} to Slack OAuth authorization page`
    );

    return res.redirect(slackAuthUrl);
  } catch (err: any) {
    logger.error(
      `Failed to create Slack OAuth URL: ${err?.message || err}`
    );

    return res.status(500).json({
      success: false,
      message: 'Failed to connect Slack',
    });
  }
}

export async function slackCallbackHandler(
  req: Request,
  res: Response
) {
  const code =
    typeof req.query.code === 'string'
      ? req.query.code
      : '';

  const state =
    typeof req.query.state === 'string'
      ? req.query.state
      : '';

  /*
   * Slack can return an OAuth error instead of a code.
   */
  const slackError =
    typeof req.query.error === 'string'
      ? req.query.error
      : '';

  logger.info(
    `Slack OAuth callback received. code=${code ? 'present' : 'missing'}, state=${state ? 'present' : 'missing'}, error=${slackError || 'none'}`
  );

  if (slackError) {
    logger.error(
      `Slack OAuth returned error: ${slackError}`
    );

    return res.redirect(
      `${env.FRONTEND_URL}?slack=failed`
    );
  }

  if (!code || !state) {
    logger.warn(
      'Slack OAuth callback received without code or state'
    );

    return res.redirect(
      `${env.FRONTEND_URL}?slack=missing_params`
    );
  }

  const userId = state;

  try {
    logger.info(
      `Processing Slack OAuth callback for user: ${userId}`
    );

    /*
     * Exchange Slack's temporary authorization code
     * for an access token.
     *
     * redirect_uri is intentionally NOT passed.
     */
    const {
      accessToken,
      slackUserId,
    } = await exchangeSlackCode(code);

    logger.info(
      `Slack token received successfully for user: ${userId}`
    );

    /*
     * Save / update Slack connection.
     */
    await prisma.slackConnection.upsert({
      where: {
        userId,
      },

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

    logger.info(
      `Slack successfully connected and token stored for user: ${userId}`
    );

    return res.redirect(
      `${env.FRONTEND_URL}?slack=connected`
    );
  } catch (err: any) {
    logger.error(
      `Slack OAuth callback processing failed: ${err?.message || err}`
    );

    return res.redirect(
      `${env.FRONTEND_URL}?slack=failed`
    );
  }
}

export async function disconnectSlack(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  try {
    await prisma.slackConnection.delete({
      where: {
        userId: req.user.id,
      },
    });

    logger.info(
      `Slack disconnected for user: ${req.user.id}`
    );

    return res.json({
      success: true,
      message: 'Slack disconnected successfully',
    });
  } catch (err: any) {
    /*
     * If no Slack connection exists, treat it as already
     * disconnected.
     */
    logger.warn(
      `Attempted to delete non-existent Slack connection for user ${req.user.id}`
    );

    return res.json({
      success: true,
      message: 'Slack was not connected or already disconnected',
    });
  }
}

export async function getSlackStatus(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  try {
    const connection =
      await prisma.slackConnection.findUnique({
        where: {
          userId: req.user.id,
        },

        select: {
          connectedAt: true,
          slackUserId: true,
        },
      });

    return res.json({
      success: true,

      data: {
        connected: !!connection,
        connection: connection || null,
      },
    });
  } catch (err: any) {
    logger.error(
      `Failed to get Slack status: ${err?.message || err}`
    );

    return res.status(500).json({
      success: false,
      message: err?.message || 'Failed to get Slack status',
    });
  }
}


