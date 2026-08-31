import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';

interface SlackOAuthResponse {
  ok: boolean;
  access_token?: string;
  bot_user_id?: string;

  authed_user?: {
    id?: string;
    scope?: string;
    access_token?: string;
    token_type?: string;
  };

  team?: {
    id?: string;
    name?: string;
  };

  app_id?: string;
  error?: string;
}

export async function exchangeSlackCode(
  code: string
): Promise<{
  accessToken: string;
  slackUserId: string;
}> {
  try {
    logger.info('Starting Slack OAuth token exchange');

    /*
     * IMPORTANT:
     * We intentionally DO NOT send redirect_uri here.
     *
     * Slack will use the Redirect URL configured under
     * Slack App -> OAuth & Permissions.
     *
     * This avoids bad_redirect_uri caused by a mismatch
     * between the authorization and token exchange steps.
     */

    const params = new URLSearchParams();

    params.append('client_id', env.SLACK_CLIENT_ID);
    params.append('client_secret', env.SLACK_CLIENT_SECRET);
    params.append('code', code);

    const response = await axios.post<SlackOAuthResponse>(
      'https://slack.com/api/oauth.v2.access',
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    logger.info(
      `Slack OAuth response: ok=${response.data.ok}, error=${response.data.error || 'none'}`
    );

    if (!response.data.ok) {
      throw new Error(
        response.data.error || 'Slack OAuth token exchange failed'
      );
    }

    if (!response.data.access_token) {
      throw new Error(
        'Slack OAuth succeeded but no access token was returned'
      );
    }

    /*
     * For a Slack bot installation, bot_user_id is the
     * correct ID to use when sending a DM with chat.postMessage.
     *
     * authed_user.id is kept as a fallback.
     */
    const slackUserId =
      response.data.bot_user_id ||
      response.data.authed_user?.id ||
      '';

    if (!slackUserId) {
      throw new Error(
        'Slack OAuth succeeded but no Slack user/bot ID was returned'
      );
    }

    logger.info(
      `Slack OAuth successful. Slack ID: ${slackUserId}`
    );

    return {
      accessToken: response.data.access_token,
      slackUserId,
    };
  } catch (err: any) {
    logger.error(
      `Slack OAuth exchange failure: ${err?.message || err}`
    );

    if (err?.response?.data) {
      logger.error(
        'Slack API error response:',
        err.response.data
      );
    }

    throw err;
  }
}

export async function sendSlackNotification(
  accessToken: string,
  slackUserId: string,
  text: string
): Promise<boolean> {
  try {
    if (!accessToken) {
      logger.warn(
        'Skipping Slack notification: access token is missing'
      );
      return false;
    }

    if (!slackUserId) {
      logger.warn(
        'Skipping Slack notification: Slack user ID is missing'
      );
      return false;
    }

    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: slackUserId,
        text,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.data.ok) {
      logger.error(
        'Slack postMessage API returned error:',
        response.data
      );

      return false;
    }

    logger.info(
      `Slack notification sent successfully to ${slackUserId}`
    );

    return true;
  } catch (err: any) {
    logger.error(
      `Failed to send Slack notification: ${err?.message || err}`
    );

    if (err?.response?.data) {
      logger.error(
        'Slack API error response:',
        err.response.data
      );
    }

    return false;
  }
}

