import { Router } from 'express';
import { createBullBoard } from '@bull-board/api';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { emailQueue } from '../queues/emailQueue';

const serverAdapter = new ExpressAdapter();

// Setup the base path of the board so links resolve correctly
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

const router = Router();

// Mount the Bull-Board dashboard router
router.use('/queues', serverAdapter.getRouter());

export default router;
