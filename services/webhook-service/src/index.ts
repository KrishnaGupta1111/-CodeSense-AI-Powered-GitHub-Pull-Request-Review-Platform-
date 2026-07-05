// ─────────────────────────────────────────────────────────────────────────────
// index.ts — Service Entry Point
//
// This is the file that actually STARTS the webhook service.
// Order of operations:
//   1. Import config (loads .env, validates env vars, sets SERVICE_NAME)
//   2. Connect to Kafka (create producer)
//   3. Create Express app (inject Kafka producer)
//   4. Start HTTP server
// ─────────────────────────────────────────────────────────────────────────────

// MUST be first import — loads .env and sets SERVICE_NAME before anything else
import './config';

import { createProducer, logger } from '@codesense/shared';
import { createApp } from './app';

const PORT = parseInt(process.env.WEBHOOK_SERVICE_PORT || '3001', 10);

async function main() {
  logger.info('Starting webhook service...');

  // ── Connect to Kafka ──────────────────────────────────────────────────────
  // We create one producer at startup and reuse it for all webhook events.
  // Creating a producer per request would require a TCP handshake with Kafka
  // on every webhook — extremely slow and wasteful.
  let producer;
  try {
    producer = await createProducer();
    logger.info('Kafka producer ready');
  } catch (err) {
    logger.error('Failed to connect to Kafka — is it running?', {
      error: err instanceof Error ? err.message : String(err),
      hint: 'Run: docker-compose up -d',
    });
    process.exit(1);
  }

  // ── Create and Start Express Server ──────────────────────────────────────
  const app = createApp(producer);

  const server = app.listen(PORT, () => {
    logger.info('Webhook service started', {
      port: PORT,
      health: `http://localhost:${PORT}/health`,
      webhook: `http://localhost:${PORT}/webhook`,
    });
  });

  // ── Graceful Shutdown ─────────────────────────────────────────────────────
  // When Docker stops a container, it sends SIGTERM.
  // We have ~30 seconds to finish in-flight requests before Docker force-kills us.
  // This handler closes the server gracefully instead of dropping connections.
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal} — shutting down gracefully`);

    server.close(async () => {
      logger.info('HTTP server closed');
      await producer.disconnect();
      logger.info('Kafka producer disconnected');
      process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT')); // Ctrl+C in development
}

// Run and catch any unhandled startup errors
main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
