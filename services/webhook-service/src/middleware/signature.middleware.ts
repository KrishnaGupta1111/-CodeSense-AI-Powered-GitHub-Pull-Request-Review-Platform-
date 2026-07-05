// ─────────────────────────────────────────────────────────────────────────────
// Webhook Signature Verification Middleware
//
// WHAT THIS DOES:
// When GitHub sends a webhook, it signs the request body using our webhook
// secret (HMAC-SHA256). This middleware verifies that signature.
//
// If the signature is invalid → reject with 401 (Unauthorized)
// If the signature is valid → call next() to proceed to the controller
//
// WHY THIS MATTERS:
// Without this check, anyone on the internet could send fake webhook requests
// to our server pretending to be GitHub. This is the first security gate.
//
// HOW HMAC-SHA256 WORKS:
// 1. GitHub takes the raw request body (the JSON string)
// 2. Hashes it using our shared secret as the key (HMAC-SHA256)
// 3. Sends the result in the X-Hub-Signature-256 header: "sha256=abc123..."
// 4. We do the same hash and compare — if they match, it's genuinely from GitHub
//
// TIMING ATTACK:
// We use crypto.timingSafeEqual() instead of === for string comparison.
// Why? The === operator exits as soon as it finds a mismatch.
// An attacker measuring response times could guess the signature character by character.
// timingSafeEqual always takes the same time regardless of where the mismatch is.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '@codesense/shared';

export function signatureMiddleware(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;

  // No signature at all — reject immediately
  if (!signature) {
    logger.warn('Webhook rejected: missing signature header');
    res.status(401).json({ error: { code: 'MISSING_SIGNATURE', message: 'X-Hub-Signature-256 header is required' } });
    return;
  }

  // req.body is a Buffer here because we use express.raw() on the webhook route
  // We need raw bytes (not parsed JSON) to compute the correct HMAC
  const rawBody = req.body as Buffer;

  if (!rawBody || rawBody.length === 0) {
    logger.warn('Webhook rejected: empty body');
    res.status(400).json({ error: { code: 'EMPTY_BODY', message: 'Request body is empty' } });
    return;
  }

  // Compute what the signature SHOULD be using our secret
  const secret = process.env.GITHUB_WEBHOOK_SECRET!;
  const computedSignature = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Compare using timing-safe comparison (prevents timing attacks)
  try {
    const sigBuffer = Buffer.from(signature);
    const computedBuffer = Buffer.from(computedSignature);

    // Buffers must be the same length for timingSafeEqual — if not, it's invalid
    if (sigBuffer.length !== computedBuffer.length) {
      logger.warn('Webhook rejected: signature length mismatch');
      res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' } });
      return;
    }

    if (!crypto.timingSafeEqual(sigBuffer, computedBuffer)) {
      logger.warn('Webhook rejected: signature mismatch');
      res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' } });
      return;
    }
  } catch (err) {
    logger.error('Signature verification error', { error: err });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Signature verification failed' } });
    return;
  }

  // Signature is valid — attach parsed body and proceed
  // Parse the raw Buffer to JSON so the controller can use it as an object
  (req as Request & { rawBody: Buffer }).rawBody = rawBody;
  req.body = JSON.parse(rawBody.toString('utf8'));

  logger.info('Webhook signature verified successfully');
  next();
}
