// MUST be the first import in index.ts — loads .env before any module initializes

import dotenv from 'dotenv';
import path from 'path';

// Load the root .env file (3 levels up from services/review-worker/src/)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

process.env.SERVICE_NAME = 'review-worker';

// Also resolve the private key path to absolute so any file can read it
// GITHUB_APP_PRIVATE_KEY_PATH is relative (e.g. "./github-app.pem")
// We resolve it to an absolute path from the project root
const rawKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH || './github-app.pem';
if (!path.isAbsolute(rawKeyPath)) {
  process.env.GITHUB_APP_PRIVATE_KEY_PATH = path.resolve(
    __dirname,
    '../../../',  // project root
    rawKeyPath
  );
}

// Fail fast if any critical variable is missing
const required = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY_PATH',
  'GEMINI_API_KEY',
  'KAFKA_BROKERS',
  'REDIS_URL',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
