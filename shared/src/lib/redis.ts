// ─────────────────────────────────────────────────────────────────────────────
// Redis Client — using ioredis
//
// WHY ioredis instead of the official 'redis' package?
// ioredis is the industry standard for Node.js + Redis:
//   - Better TypeScript support
//   - Built-in retry logic
//   - Handles connection drops automatically
//   - Used by Vercel, Upstash, and most serious Node.js applications
//
// SINGLETON PATTERN:
// We create ONE Redis connection and reuse it everywhere.
// Creating a new connection per request would be extremely slow and wasteful.
// ─────────────────────────────────────────────────────────────────────────────

import Redis from 'ioredis';
import { logger } from './logger';

let redisClient: Redis | null = null;

/**
 * Returns the shared Redis client instance.
 * Creates it on first call, reuses it on all subsequent calls.
 * This is the Singleton pattern.
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      // Retry connection up to 3 times with increasing delays
      maxRetriesPerRequest: 3,

      // Wait before reconnecting after a lost connection
      retryStrategy(times) {
        const delay = Math.min(times * 100, 3000); // max 3 second delay
        logger.warn(`Redis reconnecting... attempt ${times}`, { delay });
        return delay;
      },

      // Log when connection is established
      lazyConnect: false,
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected');
    });

    redisClient.on('error', (err) => {
      logger.error('Redis connection error', { error: err.message });
    });
  }

  return redisClient;
}

// ─── REDIS KEY HELPERS ────────────────────────────────────────────────────────
// Centralise key patterns so they're consistent across all services.
// One place to change a key format instead of hunting across 4 services.

export const RedisKeys = {
  /**
   * Deduplication lock for a specific PR + commit.
   * Set BEFORE processing. If already exists → skip (already processed).
   * TTL: 24 hours
   */
  reviewLock: (owner: string, repo: string, prNumber: number, commitSha: string) =>
    `review:lock:${owner}:${repo}:${prNumber}:${commitSha}`,

  /**
   * Cache key for an AI review of a specific diff chunk.
   * Keyed on the hash of the diff content — same diff = same review.
   * TTL: 7 days
   */
  llmCache: (chunkHash: string) =>
    `llm:cache:${chunkHash}`,

  /**
   * Per-user API rate limiting counter.
   * Tracks how many API requests a user has made in the last minute.
   * TTL: 1 minute
   */
  rateLimit: (userId: string) =>
    `rate:limit:${userId}`,

  /**
   * User session data.
   * TTL: 24 hours
   */
  session: (token: string) =>
    `session:${token}`,
} as const;

// TTL constants in seconds — one place to change all expiry durations
export const RedisTTL = {
  REVIEW_LOCK: 60 * 60 * 24,      // 24 hours
  LLM_CACHE: 60 * 60 * 24 * 7,    // 7 days
  RATE_LIMIT: 60,                  // 1 minute
  SESSION: 60 * 60 * 24,          // 24 hours
} as const;
