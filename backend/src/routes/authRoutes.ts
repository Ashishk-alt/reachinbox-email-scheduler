import { Router } from 'express';
import { redirectToGoogle, googleCallbackHandler, getMe, logout } from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get('/google', redirectToGoogle);
router.get('/google/callback', googleCallbackHandler);
router.get('/me', authMiddleware as any, getMe as any);
router.post('/logout', logout);

export default router;
