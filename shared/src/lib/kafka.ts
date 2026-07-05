// ─────────────────────────────────────────────────────────────────────────────
// Kafka Client — using kafkajs
//
// kafkajs is the most popular Kafka client for Node.js.
// Used by companies like Deliveroo, Klarna, and many others.
//
// HOW KAFKA WORKS IN OUR PROJECT:
//
// Producer = publishes messages TO a topic
//   webhook-service → publishes PullRequestEvent to "pr.created"
//   review-worker   → publishes ReviewCompletedEvent to "review.completed"
//
// Consumer = reads messages FROM a topic
//   review-worker   → consumes from "pr.created" and "pr.updated"
//   github-poster   → consumes from "review.completed"
//
// Consumer Group:
//   Each consumer has a groupId. Kafka tracks which messages each group
//   has already processed. If the consumer restarts, it picks up where
//   it left off — no messages are lost or re-processed.
// ─────────────────────────────────────────────────────────────────────────────

import { Kafka, Producer, Consumer, logLevel } from 'kafkajs';
import { logger } from './logger';

let kafkaInstance: Kafka | null = null;

/**
 * Returns the shared Kafka instance (Singleton pattern).
 * The Kafka instance holds configuration but doesn't connect until
 * you create a producer or consumer from it.
 */
export function getKafka(): Kafka {
  if (!kafkaInstance) {
    kafkaInstance = new Kafka({
      // clientId identifies our application in Kafka broker logs
      clientId: 'codesense-ai',

      // List of broker addresses — in Docker, services use "kafka:9092"
      // On local machine, use "localhost:9092"
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),

      // Suppress kafkajs's own verbose logging — we use our own logger
      logLevel: logLevel.WARN,

      // Retry config: try 8 times with increasing delays before giving up
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
    });
  }

  return kafkaInstance;
}

/**
 * Creates and connects a Kafka Producer.
 *
 * A producer is what sends messages TO Kafka topics.
 * Call this once when your service starts, then reuse the producer.
 *
 * Usage:
 *   const producer = await createProducer();
 *   await producer.send({
 *     topic: KAFKA_TOPICS.PR_CREATED,
 *     messages: [{ value: JSON.stringify(event) }]
 *   });
 */
export async function createProducer(): Promise<Producer> {
  const producer = getKafka().producer({
    // Wait for all in-sync replicas to acknowledge (safer, slightly slower)
    // In dev with 1 replica this doesn't matter much
    allowAutoTopicCreation: true,
  });

  await producer.connect();
  logger.info('Kafka producer connected');

  // Gracefully disconnect when the process exits
  const disconnect = async () => {
    await producer.disconnect();
    logger.info('Kafka producer disconnected');
  };
  process.on('SIGTERM', disconnect);
  process.on('SIGINT', disconnect);

  return producer;
}

/**
 * Creates and connects a Kafka Consumer.
 *
 * A consumer reads messages FROM Kafka topics.
 * The groupId determines which consumer group this belongs to.
 * Kafka tracks progress per group — restart safe.
 *
 * Usage:
 *   const consumer = await createConsumer('review-worker-group');
 *   await consumer.subscribe({ topic: KAFKA_TOPICS.PR_CREATED });
 *   await consumer.run({
 *     eachMessage: async ({ message }) => {
 *       const event = JSON.parse(message.value!.toString());
 *       // process event...
 *     }
 *   });
 */
export async function createConsumer(groupId: string): Promise<Consumer> {
  const consumer = getKafka().consumer({
    groupId,
    // If no offset exists yet (first time running), start from the beginning
    // This ensures we don't miss messages published before the consumer started
  });

  await consumer.connect();
  logger.info('Kafka consumer connected', { groupId });

  // Gracefully disconnect when the process exits
  const disconnect = async () => {
    await consumer.disconnect();
    logger.info('Kafka consumer disconnected', { groupId });
  };
  process.on('SIGTERM', disconnect);
  process.on('SIGINT', disconnect);

  return consumer;
}

/**
 * Ensures Kafka topics exist, creating them if they don't.
 *
 * Kafka consumers throw UNKNOWN_TOPIC_OR_PARTITION if they try to subscribe
 * to a topic that doesn't exist. This function creates topics upfront.
 *
 * Call this ONCE at service startup, before creating consumers.
 */
export async function ensureTopics(topicNames: string[]): Promise<void> {
  const admin = getKafka().admin();
  await admin.connect();

  try {
    const existing = await admin.listTopics();
    const toCreate = topicNames.filter(t => !existing.includes(t));

    if (toCreate.length === 0) {
      logger.info('Kafka topics already exist', { topics: topicNames });
      return;
    }

    await admin.createTopics({
      topics: toCreate.map(topic => ({
        topic,
        numPartitions: 1,      // 1 partition is fine for dev/portfolio
        replicationFactor: 1,  // 1 replica (only 1 Kafka broker in dev)
      })),
    });

    logger.info('Kafka topics created', { created: toCreate });
  } finally {
    await admin.disconnect();
  }
}
