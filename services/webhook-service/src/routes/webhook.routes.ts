// ─────────────────────────────────────────────────────────────────────────────
// Webhook Routes
//
// Routes define WHICH URLs exist and WHICH middleware/controller handles them.
// The actual logic lives in the controller and service layers.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { WebhookController } from '../controllers/webhook.controller';

export function createWebhookRouter(controller: WebhookController): Router {
  const router = Router();

  // POST /webhook
  // This is the URL you put in your GitHub App's Webhook URL field.
  // GitHub will POST to this endpoint every time a PR event occurs.
  // The signatureMiddleware runs BEFORE this route because it's applied
  // in app.ts on the /webhook path.
  router.post(
    '/',
    (req, res) => controller.handleWebhook(req, res)
  );

  return router;
}
