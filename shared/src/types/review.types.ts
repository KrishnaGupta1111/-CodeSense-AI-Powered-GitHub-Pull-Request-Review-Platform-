// ─────────────────────────────────────────────────────────────────────────────
// Review Types
//
// These define exactly what an AI review looks like throughout the entire system.
// The AI (Gemini) must return JSON that matches these shapes exactly.
// The webhook service, review worker, github poster, and frontend all share these.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single inline comment the AI generates for a specific line of code.
 *
 * Example:
 * {
 *   file: "src/auth.ts",
 *   line: 42,
 *   severity: "critical",
 *   category: "security",
 *   message: "SQL query built with string concatenation — vulnerable to SQL injection",
 *   suggestion: "Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [id])"
 * }
 */
export interface ReviewComment {
  file: string;        // Which file the issue is in (e.g. "src/controllers/auth.ts")
  line: number;        // Which line number (used to post inline GitHub comment)
  severity: 'critical' | 'warning' | 'suggestion'; // How serious the issue is
  category: 'security' | 'performance' | 'quality'; // What type of issue
  message: string;     // What is wrong and why
  suggestion: string;  // Exact fix or corrected code snippet
}

/**
 * Numeric scores for different aspects of the PR (0-100 each).
 * These appear on the dashboard as score cards.
 */
export interface ReviewScore {
  quality: number;     // Code readability, maintainability, best practices (0-100)
  security: number;    // Security vulnerabilities found (0-100, higher = safer)
  performance: number; // Performance issues found (0-100, higher = better)
  overall: number;     // Composite score (weighted average of above)
}

/**
 * The complete AI review result for a Pull Request.
 * This is what Gemini returns, what we store in the database,
 * and what the GitHub Poster uses to write comments on the PR.
 */
export interface ReviewResult {
  summary: string;           // Human-readable explanation of what the PR does
  score: ReviewScore;        // Numeric scores
  comments: ReviewComment[]; // Array of inline code comments
}

/**
 * Status of a review as it moves through the pipeline.
 *
 * pending   → webhook received, event published to Kafka
 * processing → review worker picked it up, calling Gemini
 * completed  → AI review done, GitHub Poster will post comments
 * posted     → comments successfully posted to GitHub PR
 * failed     → something went wrong (stored for debugging)
 */
export type ReviewStatus = 'pending' | 'processing' | 'completed' | 'posted' | 'failed';
