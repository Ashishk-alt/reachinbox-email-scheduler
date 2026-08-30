import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';

export async function healthCheck(req: Request, res: Response) {
  let dbOk = false;
  let redisOk = false;

  try {
    // Ping DB
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err: any) {
    logger.error('Healthcheck DB Ping Failed', err);
  }

  try {
    // Ping Redis
    const pingResult = await redisClient.ping();
    redisOk = pingResult === 'PONG';
  } catch (err: any) {
    logger.error('Healthcheck Redis Ping Failed', err);
  }

  const overallOk = dbOk && redisOk;
  const status = overallOk ? 200 : 503;

  res.status(status).json({
    success: overallOk,
    timestamp: new Date(),
    services: {
      database: dbOk ? 'healthy' : 'unhealthy',
      redis: redisOk ? 'healthy' : 'unhealthy',
    },
  });
}
