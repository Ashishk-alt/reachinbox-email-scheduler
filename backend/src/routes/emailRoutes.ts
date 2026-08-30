import { Router } from 'express';
import { scheduleEmails, getScheduled, getSent, searchEmailsController } from '../controllers/emailController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Secure all routes with authMiddleware
router.use(authMiddleware as any);

router.post('/schedule', scheduleEmails as any);
router.get('/scheduled', getScheduled as any);
router.get('/sent', getSent as any);
router.get('/search', searchEmailsController as any);

export default router;
