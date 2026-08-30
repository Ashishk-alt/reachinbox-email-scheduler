import { Request, Response } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

export async function redirectToGoogle(req: Request, res: Response) {
  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    client_id: env.GOOGLE_CLIENT_ID,
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
  };

  const qs = new URLSearchParams(options);
  const redirectUri = `${rootUrl}?${qs.toString()}`;
  res.redirect(redirectUri);
}

export async function googleCallbackHandler(req: Request, res: Response) {
  const code = req.query.code as string;
  if (!code) {
    logger.warn('Google OAuth login initiated but no auth code received.');
    return res.redirect(`${env.FRONTEND_URL}/login?error=no_code`);
  }

  try {
    // 1. Exchange authorization code for access and ID tokens
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const values = {
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      grant_type: 'authorization_code',
    };

    const tokenRes = await axios.post(tokenUrl, new URLSearchParams(values).toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const { access_token, id_token } = tokenRes.data;

    // 2. Retrieve user profile information using the access token
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const googleUser = userRes.data; // { sub, name, email, picture }

    if (!googleUser.email) {
      logger.warn('Google profile response did not contain email');
      return res.redirect(`${env.FRONTEND_URL}/login?error=no_email`);
    }

    // 3. Find or create the user in PostgreSQL
    let user = await prisma.user.findUnique({
      where: { email: googleUser.email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          googleId: googleUser.sub,
          name: googleUser.name || 'Google User',
          email: googleUser.email,
          avatar: googleUser.picture || null,
        },
      });

      // Automatically register the User's Google email as an initial owned Sender
      await prisma.sender.create({
        data: {
          userId: user.id,
          email: googleUser.email,
          displayName: googleUser.name || null,
        },
      });
      logger.info(`New user registered via Google: ${user.email}. Default sender created.`);
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: googleUser.sub,
          name: googleUser.name || user.name,
          avatar: googleUser.picture || user.avatar,
        },
      });
      logger.info(`Existing user logged in via Google: ${user.email}`);
    }

    // 4. Issue a signed JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // 5. Store in secure cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax',
    });

    // Redirect to the frontend dashboard
    res.redirect(env.FRONTEND_URL);
  } catch (err: any) {
    const errorDetails = err.response?.data || err.message;
    logger.error('Google OAuth flow failed', errorDetails);
    res.redirect(`${env.FRONTEND_URL}/login?error=oauth_failed`);
  }
}

export async function getMe(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        senders: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function logout(req: Request, res: Response) {
  res.clearCookie('token');
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
}
