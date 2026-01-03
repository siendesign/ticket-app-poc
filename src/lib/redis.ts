
import Redis from 'ioredis';

// Singleton for the Redis client
// We need separate clients for publishing and subscribing because
// a client in subscriber mode cannot issue other commands
const globalForRedis = globalThis as unknown as {
  redisPublisher: Redis | undefined;
  redisSubscriber: Redis | undefined;
};

const getRedisUrl = () => {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }
  
  if (process.env.NODE_ENV === 'development') {
    return 'redis://localhost:6379';
  }
  
  return undefined;
};

const createRedisClient = (type: 'publisher' | 'subscriber') => {
  const url = getRedisUrl();
  
  if (!url) {
    console.warn(`[Redis] No REDIS_URL found, ${type} will not be initialized. Realtime features may not work in distributed environments.`);
    return undefined;
  }

  console.log(`[Redis] Initializing ${type} client...`);
  
  const client = new Redis(url, {
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: type === 'subscriber' ? null : 3,
  });

  client.on('error', (err) => {
    console.error(`[Redis] ${type} error:`, err);
  });

  client.on('connect', () => {
    console.log(`[Redis] ${type} connected successfully`);
  });

  return client;
};

export const redisPublisher = globalForRedis.redisPublisher || createRedisClient('publisher');
export const redisSubscriber = globalForRedis.redisSubscriber || createRedisClient('subscriber');

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redisPublisher = redisPublisher;
  globalForRedis.redisSubscriber = redisSubscriber;
}
