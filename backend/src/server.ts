import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { createIndexIfNotExists } from './services/searchService';
import { startEmailWorker } from './workers/emailWorker';

async function startServer() {
  try {
    // ---------------------------------------------------------
    // 1. Ensure Elasticsearch index exists
    // ---------------------------------------------------------

    await createIndexIfNotExists();

    // ---------------------------------------------------------
    // 2. Start BullMQ Email Worker
    // ---------------------------------------------------------

    startEmailWorker();

    logger.info('📨 BullMQ Email Worker started successfully.');

    // ---------------------------------------------------------
    // 3. Start Express API Server
    // ---------------------------------------------------------

    const server = app.listen(env.PORT, () => {
      logger.info(
        `🚀 Express Server running in [${env.NODE_ENV}] mode on port ${env.PORT}`
      );

      logger.info(
        `📊 BullMQ Queue Board available at /admin/queues`
      );
    });

    // ---------------------------------------------------------
    // 4. Graceful Shutdown
    // ---------------------------------------------------------

    const handleExit = () => {
      logger.info('Shutting down server...');

      server.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', handleExit);
    process.on('SIGINT', handleExit);

  } catch (err: any) {
    logger.error('Failed to start API server', err);
    process.exit(1);
  }
}

startServer();
