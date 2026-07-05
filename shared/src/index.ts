// ─────────────────────────────────────────────────────────────────────────────
// @codesense/shared — Main Entry Point
//
// This file re-exports everything from the shared package.
// Other services import from '@codesense/shared' and get everything here.
//
// Usage in any service:
//   import { logger, getRedisClient, createProducer, KAFKA_TOPICS } from '@codesense/shared';
//   import type { ReviewResult, PullRequestEvent } from '@codesense/shared';
// ─────────────────────────────────────────────────────────────────────────────

// Lib exports
export { logger } from './lib/logger';
export { getRedisClient, RedisKeys, RedisTTL } from './lib/redis';
export { getKafka, createProducer, createConsumer } from './lib/kafka';

// Type exports
export type { ReviewComment, ReviewScore, ReviewResult, ReviewStatus } from './types/review.types';
export type { PullRequestEvent, ReviewCompletedEvent } from './types/kafka.types';
export { KAFKA_TOPICS } from './types/kafka.types';
export type { GitHubPullRequestWebhook, GitHubInstallationWebhook } from './types/github.types';
