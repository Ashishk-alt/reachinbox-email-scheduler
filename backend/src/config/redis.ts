import Redis from 'ioredis';
import { env } from './env';

// Connection options for BullMQ (reuses URL config)
export const redisConnectionOptions = {
  connection: {
    url: env.REDIS_URL,
    maxRetriesPerRequest: null, // Critical requirement for BullMQ
  },
};

// Standard ioredis client for rate limiting and deduplication
export const redisClient = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redisClient.on('connect', () => {
  console.log('✔ Connected to Redis');
});

redisClient.on('error', (err) => {
  console.error('❌ Redis Connection Error:', err);
});
