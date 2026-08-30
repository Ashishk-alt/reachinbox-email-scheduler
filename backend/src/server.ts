import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { createIndexIfNotExists } from './services/searchService';

async function startServer() {
  try {
    // Ensure Elasticsearch index exists
    await createIndexIfNotExists();

    const server = app.listen(env.PORT, () => {
      logger.info(`🚀 Express Server running in [${env.NODE_ENV}] mode on http://localhost:${env.PORT}`);
      logger.info(`📊 BullMQ Queue Board available at http://localhost:${env.PORT}/admin/queues`);
    });

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
