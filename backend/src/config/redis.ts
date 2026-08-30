import Redis from 'ioredis';
import { env } from './env';

const redisUrl = new URL(env.REDIS_URL);

export const redisConnectionOptions = {
  connection: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    ...(redisUrl.username && {
      username: decodeURIComponent(redisUrl.username),
    }),
    ...(redisUrl.password && {
      password: decodeURIComponent(redisUrl.password),
    }),
    maxRetriesPerRequest: null,
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
