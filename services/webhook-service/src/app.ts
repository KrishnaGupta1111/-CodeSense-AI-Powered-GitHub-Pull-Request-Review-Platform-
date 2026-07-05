// ─────────────────────────────────────────────────────────────────────────────
// Express App Setup
//
// This file creates and configures the Express application.
// It does NOT start the server (that's index.ts's job).
// Separating app creation from server startup makes testing easier —
// you can import the app without actually binding to a port.
// ─────────────────────────────────────────────────────────────────────────────

import express, { Application, Request, Response, NextFunction } from 'express';
import { signatureMiddleware } from './middleware/signature.middleware';
import { createWebhookRouter } from './routes/webhook.routes';
import { WebhookController } from './controllers/webhook.controller';
import { WebhookService } from './services/webhook.service';
import { logger } from '@codesense/shared';
import { Producer } from 'kafkajs';

export function createApp(producer: Producer): Application {
  const app = express();

  // ── Middleware: Webhook Route ─────────────────────────────────────────────
  // IMPORTANT: For the /webhook route, we use express.raw() NOT express.json()
  //
  // Why? The HMAC-SHA256 signature is computed on the RAW request body bytes.
  // If we use express.json(), Express parses the body first — the raw bytes
  // are gone and we can't verify the signature correctly.
  //
  // express.raw() gives us req.body as a Buffer (raw bytes).
  // The signatureMiddleware then:
  //   1. Verifies the signature using the raw Buffer
  //   2. Parses the Buffer to JSON and replaces req.body with the parsed object
  //   3. Calls next() so the controller gets req.body as a normal JS object
  app.use(
    '/webhook',
    express.raw({ type: 'application/json', limit: '10mb' }),
    signatureMiddleware
  );

  // ── Middleware: General ───────────────────────────────────────────────────
  // For all other routes (like /health), use normal JSON parsing
  app.use(express.json());

  // ── Routes ───────────────────────────────────────────────────────────────
  const webhookService = new WebhookService(producer);
  const webhookController = new WebhookController(webhookService);
  const webhookRouter = createWebhookRouter(webhookController);

  app.use('/webhook', webhookRouter);

  // ── Health Check Endpoint ─────────────────────────────────────────────────
  // GET /health
  // Required by Docker, Kubernetes, and load balancers to check if the
  // service is alive and ready to accept traffic.
  // Our deployment pipeline (Railway/Render) also pings this before routing traffic.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'webhook-service',
      uptime: Math.floor(process.uptime()),   // seconds since service started
      timestamp: new Date().toISOString(),
    });
  });

  // ── Global Error Handler ──────────────────────────────────────────────────
  // Catches any unhandled errors from routes/middleware
  // Must have 4 parameters — Express identifies error handlers by parameter count
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });

    // Never expose raw error details to the client — log them but send generic message
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });

  return app;
}
