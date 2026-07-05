// ─────────────────────────────────────────────────────────────────────────────
// Review Service — Orchestrates the full AI review pipeline
//
// This is the "director" that coordinates the other services:
//
//   1. DiffService  → fetches PR files from GitHub
//   2. AIService    → sends diff to Gemini, gets review back
//   3. Kafka        → publishes the completed review for github-poster
//
// This service is called once per Kafka message (per PR event).
// ─────────────────────────────────────────────────────────────────────────────

import { Producer } from 'kafkajs';
import crypto from 'crypto';
import { KAFKA_TOPICS, logger } from '@codesense/shared';
import type { PullRequestEvent, ReviewCompletedEvent } from '@codesense/shared';
import { DiffService } from './diff.service';
import { AIService } from './ai.service';

export class ReviewService {
  private readonly diffService: DiffService;
  private readonly aiService: AIService;

  constructor(private readonly producer: Producer) {
    this.diffService = new DiffService();
    this.aiService = new AIService();
  }

  /**
   * Full review pipeline for a single PR event.
   *
   * Called by PRConsumer for every message consumed from Kafka.
   */
  async processReview(event: PullRequestEvent): Promise<void> {
    const { owner, repo, prNumber, prTitle, installationId, commitSha } = event;

    // Generate a unique ID for this review (used to link DB records later)
    const reviewId = crypto.randomUUID();

    logger.info('Starting review pipeline', {
      reviewId,
      owner,
      repo,
      prNumber,
      action: event.action,
    });

    try {
      // ── Step 1: Fetch PR files from GitHub ─────────────────────────────────
      const files = await this.diffService.fetchPRFiles(
        owner,
        repo,
        prNumber,
        installationId
      );

      if (files.length === 0) {
        logger.info('No reviewable files in this PR — skipping review', {
          owner,
          repo,
          prNumber,
          hint: 'All changed files are binary, lock files, or have no diff',
        });
        return; // Nothing to review — gracefully exit
      }

      // ── Step 2: Build diff string ───────────────────────────────────────────
      const { diff, truncated } = this.diffService.buildDiffString(files);

      if (truncated) {
        logger.warn('Diff was truncated due to size — large PR', {
          owner,
          repo,
          prNumber,
          totalFiles: files.length,
        });
      }

      // ── Step 3: Get AI Review ───────────────────────────────────────────────
      // This is the main event — sending the diff to Gemini and getting back
      // a structured review with scores and inline comments
      const reviewResult = await this.aiService.reviewDiff(
        prTitle,
        owner,
        repo,
        diff
      );

      // ── Step 4: Publish to Kafka → github-poster will pick this up ──────────
      // The github-poster service consumes 'review.completed' and posts
      // the review comments to the actual GitHub PR
      const completedEvent: ReviewCompletedEvent = {
        owner,
        repo,
        prNumber,
        commitSha,
        installationId,
        reviewId,
        result: reviewResult,
      };

      await this.producer.send({
        topic: KAFKA_TOPICS.REVIEW_COMPLETED,
        messages: [
          {
            // Key ensures all messages for same PR go to same Kafka partition
            // This maintains ordering if multiple events come in for one PR
            key: `${owner}/${repo}/${prNumber}`,
            value: JSON.stringify(completedEvent),
          },
        ],
      });

      logger.info('Review pipeline completed successfully', {
        reviewId,
        owner,
        repo,
        prNumber,
        commentsGenerated: reviewResult.comments.length,
        scores: reviewResult.score,
        truncated,
      });

    } catch (err) {
      logger.error('Review pipeline failed', {
        reviewId,
        owner,
        repo,
        prNumber,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });

      // Re-throw so the consumer knows this message failed
      // The consumer will log it but NOT retry (to avoid infinite loops)
      throw err;
    }
  }
}
