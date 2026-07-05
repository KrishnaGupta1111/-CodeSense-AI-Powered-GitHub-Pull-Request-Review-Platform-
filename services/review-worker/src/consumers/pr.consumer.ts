// ─────────────────────────────────────────────────────────────────────────────
// PR Consumer — Kafka message consumer
//
// This is the "ear" of the review-worker service.
// It continuously listens to Kafka topics for PR events and processes them.
//
// HOW KAFKA CONSUMERS WORK:
//
// Kafka stores messages in "topics" (like queues/channels).
// A consumer "subscribes" to topics and processes one message at a time.
//
// Consumer Group ("review-worker-group"):
// Kafka tracks which messages each group has already processed.
// If this service restarts, it picks up exactly where it left off —
// no messages are lost, no messages are double-processed.
// This is called "at-least-once delivery" and is a key Kafka feature.
//
// eachMessage:
// Called once per message. If it throws an error, kafkajs logs it and
// moves to the next message. The message is still marked as processed.
// (For production, you'd use manual commits for exactly-once guarantees,
// but for a portfolio project, autoCommit is the right choice.)
// ─────────────────────────────────────────────────────────────────────────────

import { Consumer } from 'kafkajs';
import { KAFKA_TOPICS, logger } from '@codesense/shared';
import type { PullRequestEvent } from '@codesense/shared';
import { ReviewService } from '../services/review.service';

export class PRConsumer {
  constructor(
    private readonly consumer: Consumer,
    private readonly reviewService: ReviewService
  ) {}

  async start(): Promise<void> {
    // Subscribe to both topics
    // fromBeginning: false = start from NEW messages only (don't reprocess history)
    await this.consumer.subscribe({
      topics: [KAFKA_TOPICS.PR_CREATED, KAFKA_TOPICS.PR_UPDATED],
      fromBeginning: false,
    });

    logger.info('PR consumer subscribed and ready', {
      topics: [KAFKA_TOPICS.PR_CREATED, KAFKA_TOPICS.PR_UPDATED],
      groupId: 'review-worker-group',
    });

    // Start the consumer loop — this runs forever (until the process exits)
    await this.consumer.run({
      // eachMessage is called for every single message on the subscribed topics
      eachMessage: async ({ topic, partition, message }) => {
        const rawValue = message.value?.toString();

        if (!rawValue) {
          logger.warn('Received empty Kafka message — skipping', { topic, partition });
          return;
        }

        // Parse the message from JSON string → PullRequestEvent object
        let event: PullRequestEvent;
        try {
          event = JSON.parse(rawValue) as PullRequestEvent;
        } catch (err) {
          logger.error('Failed to parse Kafka message as JSON — skipping', {
            topic,
            rawValuePreview: rawValue.slice(0, 200),
            error: err instanceof Error ? err.message : String(err),
          });
          return; // Skip malformed messages — can't do anything with them
        }

        logger.info('Kafka message received — starting review', {
          topic,
          owner: event.owner,
          repo: event.repo,
          prNumber: event.prNumber,
          action: event.action,
          commitSha: event.commitSha.slice(0, 8), // only log first 8 chars
        });

        // Process the review
        // If this throws, kafkajs logs the error and moves to the next message
        // The Redis dedup lock was already set by webhook-service, so even if
        // we crash mid-review and restart, we won't process the same PR again
        try {
          await this.reviewService.processReview(event);
        } catch (err) {
          logger.error('Failed to process PR review', {
            owner: event.owner,
            repo: event.repo,
            prNumber: event.prNumber,
            error: err instanceof Error ? err.message : String(err),
          });
          // Don't re-throw — let Kafka continue to the next message
          // A failed review is unfortunate but shouldn't stop the whole worker
        }
      },
    });
  }
}
