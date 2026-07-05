// ─────────────────────────────────────────────────────────────────────────────
// Kafka Event Types
//
// These define the shape of messages published to and consumed from Kafka topics.
//
// TOPICS:
//   pr.created / pr.updated → PullRequestEvent (published by webhook-service)
//   review.completed        → ReviewCompletedEvent (published by review-worker)
// ─────────────────────────────────────────────────────────────────────────────

import { ReviewResult } from './review.types';

/**
 * Kafka topic names as constants.
 * Using constants instead of strings prevents typos across services.
 *
 * Bad:  producer.send({ topic: 'pr.craeted', ... })  ← typo, silent bug
 * Good: producer.send({ topic: KAFKA_TOPICS.PR_CREATED, ... })  ← TypeScript catches typos
 */
export const KAFKA_TOPICS = {
  PR_CREATED: 'pr.created',
  PR_UPDATED: 'pr.updated',
  REVIEW_COMPLETED: 'review.completed',
} as const;

/**
 * The event published to Kafka when a PR is opened or updated.
 *
 * Published by: webhook-service
 * Consumed by:  review-worker
 *
 * Contains everything the review-worker needs to:
 * 1. Fetch the PR diff from GitHub (using owner, repo, prNumber, installationId)
 * 2. Store the review in the database
 * 3. Deduplicate using commitSha
 */
export interface PullRequestEvent {
  owner: string;          // GitHub repo owner (e.g. "KrishnaGupta1111")
  repo: string;           // Repository name (e.g. "my-project")
  prNumber: number;       // PR number (e.g. 42)
  prTitle: string;        // PR title (e.g. "feat: add user authentication")
  commitSha: string;      // Latest commit SHA — used for deduplication
  installationId: number; // GitHub App installation ID — needed to generate access token
  action: 'opened' | 'synchronize' | 'reopened'; // What triggered this event
  senderLogin: string;    // GitHub username who opened the PR
}

/**
 * The event published to Kafka when the AI review is complete.
 *
 * Published by: review-worker
 * Consumed by:  github-poster
 *
 * Contains everything the github-poster needs to:
 * 1. Post inline comments to the PR
 * 2. Post a summary comment
 * 3. Update review status in the database
 */
export interface ReviewCompletedEvent {
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
  installationId: number;
  reviewId: string;        // Database ID of the review record
  result: ReviewResult;    // The complete AI review output
}
