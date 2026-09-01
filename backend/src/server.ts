import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { logger } from './utils/logger';
import {
  reconcileScheduledJobs,
  startEmailWorker,
} from './workers/emailWorker';

import authRoutes from './routes/authRoutes';
import emailRoutes from './routes/emailRoutes';
import adminRoutes from './routes/adminRoutes';
import healthRoutes from './routes/healthRoutes';
import slackRoutes from './routes/slackRoutes';

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/slack', slackRoutes);

const PORT = Number(env.PORT || 5000);

let workerStarted = false;
let serverStarted = false;

async function startServer() {
  try {
    await reconcileScheduledJobs();

    if (!workerStarted) {
      startEmailWorker();
      workerStarted = true;

      logger.info(
        '📨 BullMQ Email Worker started successfully.'
      );
    }

    if (serverStarted) {
      return;
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      serverStarted = true;

      logger.info(
        `🚀 Express Server running in [${env.NODE_ENV || 'development'}] mode on port ${PORT}`
      );

      logger.info(
        `📊 BullMQ Queue Board available at /admin/queues`
      );
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(
          `❌ Port ${PORT} is already in use.`
        );
      } else {
        logger.error(
          '❌ HTTP server error',
          error
        );
      }
    });

    const shutdown = async () => {
      logger.info('Shutting down server...');

      server.close(() => {
        logger.info('HTTP server closed.');
      });

      process.exit(0);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error: any) {
    logger.error(
      'Failed to start API server',
      error
    );

    process.exit(1);
  }
}

startServer();
