// ─────────────────────────────────────────────────────────────────────────────
// Webhook Controller
//
// The controller sits between the route and the service.
// Its job: handle the HTTP request/response and call the service.
//
// IMPORTANT: We respond to GitHub FIRST, then process asynchronously.
//
// Why? GitHub expects a 2xx response within 10 seconds.
// If we make GitHub wait while we talk to Redis and Kafka, we might time out.
// The correct pattern:
//   1. Validate the event type and action
//   2. Respond 202 Accepted immediately
//   3. Process in the background (async, after the response is sent)
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import { logger } from '@codesense/shared';
import type { GitHubPullRequestWebhook } from '@codesense/shared';
import { WebhookService } from '../services/webhook.service';

// The actions we care about — ignore everything else
const HANDLED_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);

export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  /**
   * POST /webhook
   * Main webhook handler for all GitHub events
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    // GitHub tells us what kind of event this is via this header
    const eventType = req.headers['x-github-event'] as string;

    // Unique ID for this webhook delivery — useful for debugging
    const deliveryId = req.headers['x-github-delivery'] as string;

    logger.info('Webhook received', { eventType, deliveryId });

    // ── Filter: Only handle pull_request events ───────────────────────────────
    // GitHub App sends many event types (push, issues, etc.)
    // We only care about pull_request events
    if (eventType !== 'pull_request') {
      res.status(200).json({ status: 'ignored', reason: `event type '${eventType}' not handled` });
      return;
    }

    const payload = req.body as GitHubPullRequestWebhook;

    // ── Filter: Only handle specific PR actions ───────────────────────────────
    // pull_request events have many actions: opened, closed, labeled, assigned...
    // We only want: opened (new PR), synchronize (new commit), reopened
    if (!HANDLED_ACTIONS.has(payload.action)) {
      res.status(200).json({ status: 'ignored', reason: `action '${payload.action}' not handled` });
      return;
    }

    // ── Respond immediately — do NOT make GitHub wait ─────────────────────────
    // 202 Accepted = "I received it and will process it, but haven't yet"
    // This is semantically more correct than 200 OK for async processing
    res.status(202).json({ status: 'accepted', deliveryId });

    // ── Process asynchronously AFTER responding ───────────────────────────────
    // Any errors here are logged but don't affect the 202 we already sent
    try {
      const processed = await this.webhookService.processEvent(payload);

      if (processed) {
        logger.info('Webhook event processed successfully', {
          deliveryId,
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          prNumber: payload.number,
          action: payload.action,
        });
      }
    } catch (err) {
      logger.error('Failed to process webhook event', {
        deliveryId,
        error: err instanceof Error ? err.message : String(err),
        owner: payload.repository?.owner?.login,
        repo: payload.repository?.name,
        prNumber: payload.number,
      });
    }
  }
}
