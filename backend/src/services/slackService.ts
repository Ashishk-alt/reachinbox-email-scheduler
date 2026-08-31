import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';

interface SlackOAuthResponse {
  ok: boolean;
  access_token?: string;
  authed_user?: {
    id: string;
  };
  error?: string;
}

export async function exchangeSlackCode(
  code: string
): Promise<{ accessToken: string; slackUserId: string }> {
  try {
    const response = await axios.post<SlackOAuthResponse>(
      'https://slack.com/api/oauth.v2.access',
      new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: env.SLACK_CALLBACK_URL,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    logger.info(
      `Slack OAuth response: ok=${response.data.ok}, error=${response.data.error || 'none'}`
    );

    if (!response.data.ok || !response.data.access_token) {
      throw new Error(
        response.data.error || 'Failed to exchange code for Slack access token'
      );
    }

    return {
      accessToken: response.data.access_token,
      slackUserId: response.data.authed_user?.id || '',
    };
  } catch (err: any) {
    logger.error(
      `Slack OAuth exchange failure: ${err.response?.data?.error || err.message}`
    );

    throw err;
  }
}

export async function sendSlackNotification(
  accessToken: string,
  slackUserId: string,
  text: string
): Promise<boolean> {
  try {
    if (!slackUserId) {
      logger.warn(
        'Skipping Slack notification: Slack User ID is not available'
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
        'Slack postMessage API returned error',
        response.data
      );
      return false;
    }

    logger.info(
      `Slack notification sent to user ${slackUserId}`
    );

    return true;
  } catch (err: any) {
    logger.error(
      'Failed to send Slack notification',
      err.response?.data || err.message
    );

    return false;
  }
}
