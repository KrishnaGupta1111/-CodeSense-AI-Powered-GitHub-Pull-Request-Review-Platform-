// ─────────────────────────────────────────────────────────────────────────────
// AI Service — Calls Google Gemini to review code diffs
//
// KEY CONCEPTS:
//
// 1. responseMimeType: 'application/json'
//    This is Gemini's "JSON mode". Like OpenAI's JSON mode.
//    Forces the model to return valid JSON instead of markdown text.
//    Without this, Gemini wraps the JSON in ```json ``` blocks which
//    break JSON.parse().
//
// 2. Redis Caching
//    We hash the diff content (SHA-256). Same diff = same hash = cache hit.
//    If a developer pushes the same commit twice (force push, revert),
//    we return the cached review instantly without calling Gemini again.
//    This saves API quota and reduces response time from ~10s to <100ms.
//
// 3. Retry with Schema Validation
//    Even in JSON mode, AI models occasionally return malformed output.
//    We validate the response against our schema and retry once if invalid.
//    On second failure, we return a fallback result instead of crashing.
//    A failed review is better than a crashed service.
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import crypto from 'crypto';
import { getRedisClient, RedisKeys, RedisTTL, logger } from '@codesense/shared';
import type { ReviewResult } from '@codesense/shared';
import { buildReviewPrompt } from '../prompts/review.prompt';

export class AIService {
  private genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  }

  /**
   * Returns the Gemini model with JSON mode enabled.
   * On retry (attempt > 1), we use stricter settings:
   *   - lower temperature (more deterministic, less creative)
   *   - more explicit system instruction
   */
  private getModel(isRetry: boolean = false): GenerativeModel {
    return this.genAI.getGenerativeModel({
      model: 'gemini-1.5-flash', // Free tier: 15 requests/minute, 1M tokens/minute

      generationConfig: {
        // JSON mode — forces the model to output valid JSON
        responseMimeType: 'application/json',

        // Temperature: 0 = deterministic, 1 = creative/random
        // Lower temperature for code review = more consistent, less "hallucination"
        temperature: isRetry ? 0.1 : 0.3,

        // Max tokens in the response
        maxOutputTokens: 4096,
      },

      // On retry, be even more explicit that we want JSON only
      systemInstruction: isRetry
        ? 'You are a code reviewer. Return ONLY valid JSON matching the provided schema. No markdown. No text outside JSON.'
        : undefined,
    });
  }

  /**
   * Validates that the AI response matches our ReviewResult schema.
   * TypeScript's type system can't validate at runtime, so we do it manually.
   *
   * This is a "type guard" — a function that narrows the type from 'unknown' to ReviewResult.
   */
  private isValidReviewResult(data: unknown): data is ReviewResult {
    if (typeof data !== 'object' || data === null) return false;

    const obj = data as Record<string, unknown>;

    // Must have a summary string
    if (typeof obj.summary !== 'string' || obj.summary.length === 0) return false;

    // Must have score object with all 4 numeric fields
    if (typeof obj.score !== 'object' || obj.score === null) return false;
    const score = obj.score as Record<string, unknown>;
    if (typeof score.quality !== 'number') return false;
    if (typeof score.security !== 'number') return false;
    if (typeof score.performance !== 'number') return false;
    if (typeof score.overall !== 'number') return false;

    // Must have comments array (can be empty)
    if (!Array.isArray(obj.comments)) return false;

    // Each comment must have required fields
    for (const comment of obj.comments) {
      if (typeof comment !== 'object' || comment === null) return false;
      const c = comment as Record<string, unknown>;
      if (typeof c.file !== 'string') return false;
      if (typeof c.line !== 'number') return false;
      if (!['critical', 'warning', 'suggestion'].includes(c.severity as string)) return false;
      if (!['security', 'performance', 'quality'].includes(c.category as string)) return false;
      if (typeof c.message !== 'string') return false;
      if (typeof c.suggestion !== 'string') return false;
    }

    return true;
  }

  /**
   * Main method: reviews a diff using Gemini AI.
   *
   * Flow:
   *   1. Hash the diff → check Redis cache
   *   2. Cache hit → return immediately (no Gemini call)
   *   3. Cache miss → call Gemini (up to 2 attempts)
   *   4. Validate response schema
   *   5. Cache the result for future identical diffs
   *   6. Return the review
   */
  async reviewDiff(
    prTitle: string,
    owner: string,
    repo: string,
    diff: string
  ): Promise<ReviewResult> {
    // ── Cache Check ────────────────────────────────────────────────────────────
    // SHA-256 hash of the diff content — same diff always produces same hash
    const diffHash = crypto
      .createHash('sha256')
      .update(`${prTitle}:${diff}`) // include PR title in hash
      .digest('hex');

    const cacheKey = RedisKeys.llmCache(diffHash);
    const redis = getRedisClient();

    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.info('AI review cache hit — skipping Gemini call', {
        diffHash: diffHash.slice(0, 12), // only log first 12 chars for readability
      });
      return JSON.parse(cached) as ReviewResult;
    }

    // ── Gemini Call (with retry) ───────────────────────────────────────────────
    const prompt = buildReviewPrompt(prTitle, owner, repo, diff);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        logger.info('Calling Gemini AI', {
          attempt,
          diffChars: diff.length,
          model: 'gemini-1.5-flash',
        });

        const model = this.getModel(attempt === 2); // stricter settings on retry
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // Parse JSON — may throw if Gemini still returned non-JSON
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error(
            `Gemini returned invalid JSON on attempt ${attempt}. ` +
            `First 300 chars: ${text.slice(0, 300)}`
          );
        }

        // Validate the schema
        if (!this.isValidReviewResult(parsed)) {
          throw new Error(
            `Gemini response failed schema validation on attempt ${attempt}. ` +
            `Keys found: ${Object.keys(parsed as object).join(', ')}`
          );
        }

        // ── Cache the valid result ───────────────────────────────────────────
        await redis.setex(cacheKey, RedisTTL.LLM_CACHE, JSON.stringify(parsed));

        logger.info('AI review completed successfully', {
          attempt,
          commentsCount: parsed.comments.length,
          scores: parsed.score,
          cached: true,
        });

        return parsed;

      } catch (err) {
        logger.warn(`AI review attempt ${attempt} failed`, {
          error: err instanceof Error ? err.message : String(err),
          willRetry: attempt === 1,
        });

        if (attempt === 2) {
          // Both attempts failed — return a safe fallback instead of crashing
          // The webhook service already responded 202 to GitHub, so crashing
          // here just means no review gets posted (better than a stuck service)
          logger.error('AI review failed after 2 attempts — returning fallback result');
          return {
            summary: 'Automated review could not be completed due to an AI service error. Please review this PR manually.',
            score: { quality: 50, security: 50, performance: 50, overall: 50 },
            comments: [],
          };
        }

        // Wait 2 seconds before retry to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // TypeScript requires this even though the loop always returns
    throw new Error('Unreachable code');
  }
}
