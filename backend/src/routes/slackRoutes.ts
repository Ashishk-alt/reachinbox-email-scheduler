import { Router } from 'express';

import {
  connectSlack,
  slackCallbackHandler,
  disconnectSlack,
  getSlackStatus
} from '../controllers/slackController';

import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Callback is invoked by Slack
router.get('/oauth/callback', slackCallbackHandler);

// Other endpoints are secured by authentication
router.get('/connect', authMiddleware as any, connectSlack as any);

router.post('/disconnect', authMiddleware as any, disconnectSlack as any);

router.get('/status', authMiddleware as any, getSlackStatus as any);

export default router;
