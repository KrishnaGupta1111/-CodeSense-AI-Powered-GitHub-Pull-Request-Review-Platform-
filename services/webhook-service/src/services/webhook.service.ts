// ─────────────────────────────────────────────────────────────────────────────
// Webhook Service — Business Logic
//
// This is where the actual work happens after the signature is verified:
// 1. Check Redis: have we already processed this exact PR + commit?
// 2. If yes → silently ignore (idempotency)
// 3. If no → set Redis lock + publish to Kafka
//
// WHY IDEMPOTENCY MATTERS:
// GitHub's webhook delivery system retries on failure. If our server returns
// a non-2xx response (or times out), GitHub will send the SAME webhook again.
// Without Redis deduplication, we'd review the same PR twice and post
// duplicate AI comments — which is embarrassing and confusing for developers.
// ─────────────────────────────────────────────────────────────────────────────

import { Producer } from 'kafkajs';
import {
  getRedisClient,
  RedisKeys,
  RedisTTL,
  KAFKA_TOPICS,
  logger,
} from '@codesense/shared';
import type {
  GitHubPullRequestWebhook,
  PullRequestEvent,
} from '@codesense/shared';

export class WebhookService {
  // The Kafka producer is injected via constructor (Dependency Injection pattern)
  // This makes the service easier to test — you can pass a mock producer in tests
  constructor(private readonly producer: Producer) {}

  /**
   * Processes a validated pull_request webhook event.
   *
   * Returns true if the event was processed (published to Kafka).
   * Returns false if the event was a duplicate (silently ignored).
   */
  async processEvent(payload: GitHubPullRequestWebhook): Promise<boolean> {
    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const prNumber = payload.number;
    const commitSha = payload.pull_request.head.sha;
    const installationId = payload.installation.id;

    // ── Step 1: Deduplication Check ──────────────────────────────────────────
    // Build the Redis lock key — unique to this specific PR + commit combination
    const lockKey = RedisKeys.reviewLock(owner, repo, prNumber, commitSha);
    const redis = getRedisClient();

    // SET key value EX ttl NX
    // EX = expires in N seconds
    // NX = only set if the key does NOT already exist
    // Returns 'OK' if key was newly set, null if key already existed
    const lockAcquired = await redis.set(
      lockKey,
      '1',
      'EX',
      RedisTTL.REVIEW_LOCK,
      'NX'
    );

    if (lockAcquired === null) {
      // Key already existed — this is a duplicate webhook
      logger.warn('Duplicate webhook detected — skipping', {
        owner,
        repo,
        prNumber,
        commitSha,
        lockKey,
      });
      return false;
    }

    logger.info('Redis lock acquired — processing event', {
      owner,
      repo,
      prNumber,
      commitSha,
    });

    // ── Step 2: Build the Kafka Event ────────────────────────────────────────
    // This is the message that the review-worker will consume
    const event: PullRequestEvent = {
      owner,
      repo,
      prNumber,
      prTitle: payload.pull_request.title,
      commitSha,
      installationId,
      action: payload.action as PullRequestEvent['action'],
      senderLogin: payload.pull_request.user.login,
    };

    // ── Step 3: Determine Kafka Topic ─────────────────────────────────────────
    // 'opened' or 'reopened' → pr.created topic
    // 'synchronize' (new commit pushed) → pr.updated topic
    const topic = payload.action === 'synchronize'
      ? KAFKA_TOPICS.PR_UPDATED
      : KAFKA_TOPICS.PR_CREATED;

    // ── Step 4: Publish to Kafka ──────────────────────────────────────────────
    // The message key is "owner/repo/prNumber" — Kafka uses this to ensure
    // all messages for the same PR go to the same partition (ordering guarantee)
    await this.producer.send({
      topic,
      messages: [
        {
          key: `${owner}/${repo}/${prNumber}`,
          value: JSON.stringify(event),
        },
      ],
    });

    logger.info('Event published to Kafka', {
      topic,
      owner,
      repo,
      prNumber,
      action: payload.action,
    });

    return true;
  }
}
