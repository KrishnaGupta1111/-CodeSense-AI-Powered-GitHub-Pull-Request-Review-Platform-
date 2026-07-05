// ─────────────────────────────────────────────────────────────────────────────
// config.ts — Environment Setup
//
// WHY THIS FILE EXISTS:
// In Node.js (CommonJS), imports are loaded in ORDER when the file is first required.
// This means if we import config.ts FIRST in index.ts, dotenv runs before
// anything else, and all env variables are available when other modules initialize.
//
// This must always be the FIRST import in index.ts.
// ─────────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';
import path from 'path';

// Load .env from the project root (two levels up from services/webhook-service/)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Set the service name — used by the shared logger to identify which service
// is generating each log entry
process.env.SERVICE_NAME = 'webhook-service';

// ─── Validate required environment variables ──────────────────────────────────
// Fail fast: if critical config is missing, crash immediately with a clear error
// rather than failing silently hours later during a webhook call
const required = [
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_APP_ID',
  'KAFKA_BROKERS',
  'REDIS_URL',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    console.error(`   Check your .env file at the project root.`);
    process.exit(1); // Exit with error code
  }
}
