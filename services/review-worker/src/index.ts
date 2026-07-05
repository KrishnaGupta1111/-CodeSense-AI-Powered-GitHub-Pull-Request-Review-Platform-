// MUST be first import — loads .env and sets SERVICE_NAME before anything else
import './config';

import { createProducer, createConsumer, ensureTopics, logger } from '@codesense/shared';
import { KAFKA_TOPICS } from '@codesense/shared';
import { ReviewService } from './services/review.service';
import { PRConsumer } from './consumers/pr.consumer';

async function main() {
  logger.info('Starting review worker...');

  // ── Connect to Kafka ──────────────────────────────────────────────────────
  // We need BOTH a producer (to publish review.completed events) AND
  // a consumer (to read pr.created / pr.updated events)
  let producer;
  let consumer;

  try {
    producer = await createProducer();
    consumer = await createConsumer('review-worker-group');
    logger.info('Kafka connections established (producer + consumer)');

    // Create Kafka topics if they don't exist yet
    // Consumers throw UNKNOWN_TOPIC_OR_PARTITION if topics don't exist
    await ensureTopics([
      KAFKA_TOPICS.PR_CREATED,
      KAFKA_TOPICS.PR_UPDATED,
      KAFKA_TOPICS.REVIEW_COMPLETED,
    ]);
  } catch (err) {
    logger.error('Failed to connect to Kafka', {
      error: err instanceof Error ? err.message : String(err),
      hint: 'Run: docker-compose up -d',
    });
    process.exit(1);
  }

  // ── Wire up services ──────────────────────────────────────────────────────
  const reviewService = new ReviewService(producer);
  const prConsumer = new PRConsumer(consumer, reviewService);

  // ── Start consuming ───────────────────────────────────────────────────────
  // This call blocks forever — the consumer runs until the process exits
  await prConsumer.start();

  logger.info('Review worker is running and waiting for PR events', {
    topics: ['pr.created', 'pr.updated'],
    groupId: 'review-worker-group',
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
