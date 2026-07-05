// ─────────────────────────────────────────────────────────────────────────────
// Structured Logger — using Winston
//
// WHY NOT console.log?
//
// console.log("PR received")          → useless in production
// logger.info("PR received", {...})   → searchable, filterable, timestamped JSON
//
// In production, logs go to a log aggregator (Datadog, CloudWatch, etc.)
// They can only be searched/filtered if they're structured JSON.
// console.log outputs plain text that can't be parsed.
//
// Every log entry automatically includes:
//   timestamp   → when it happened
//   level       → info / warn / error
//   service     → which service logged it (set via SERVICE_NAME env var)
//   message     → what happened
//   ...context  → any extra data you pass in
// ─────────────────────────────────────────────────────────────────────────────

import winston from 'winston';

const logger = winston.createLogger({
  // Log level: in production use 'info', in development use 'debug'
  // 'debug' logs everything including verbose details
  // 'info' logs normal operations
  // 'warn' logs unexpected but non-fatal situations
  // 'error' logs failures
  level: process.env.LOG_LEVEL || 'info',

  // Format: combine multiple formatters
  format: winston.format.combine(
    // Add timestamp to every log entry
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),

    // Add error stack traces when logging Error objects
    winston.format.errors({ stack: true }),

    // Output as JSON — machine-readable, searchable in log aggregators
    winston.format.json()
  ),

  // Default fields added to EVERY log entry automatically
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'unknown-service',
  },

  transports: [
    // Write to console (Docker captures this and forwards to log aggregators)
    new winston.transports.Console({
      // In development, use colorized human-readable format instead of JSON
      format: process.env.NODE_ENV === 'development'
        ? winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        : winston.format.json(),
    }),
  ],
});

export { logger };

// ─── USAGE EXAMPLES ──────────────────────────────────────────────────────────
//
// import { logger } from '@codesense/shared';
//
// logger.info('Webhook received', { owner: 'KrishnaGupta1111', repo: 'my-project', pr: 42 });
// logger.warn('Duplicate webhook detected', { lockKey: 'review:lock:...' });
// logger.error('Failed to call Gemini API', { error: err.message, prNumber: 42 });
//
// Output (JSON in production):
// {
//   "timestamp": "2024-01-15 14:32:01",
//   "level": "info",
//   "service": "webhook-service",
//   "message": "Webhook received",
//   "owner": "KrishnaGupta1111",
//   "repo": "my-project",
//   "pr": 42
// }
