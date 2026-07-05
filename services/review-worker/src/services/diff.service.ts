// ─────────────────────────────────────────────────────────────────────────────
// Diff Service — Fetches PR code changes from GitHub
//
// HOW GITHUB APP AUTHENTICATION WORKS:
//
// To call the GitHub API on behalf of a repository that installed our App,
// we need an "installation access token". Here's the flow:
//
// Step 1: We create a JWT (JSON Web Token) signed with our private key.
//         GitHub trusts this JWT because only someone with the private key
//         can create a valid one. This JWT lasts 10 minutes.
//
// Step 2: We exchange the JWT for an "installation access token" specific
//         to the repository's installation. This token lasts 1 hour.
//
// Step 3: We use the installation access token like a regular API token
//         to make GitHub API calls.
//
// The @octokit/auth-app library handles Steps 1 and 2 automatically.
// We just provide the appId, privateKey, and installationId.
// ─────────────────────────────────────────────────────────────────────────────

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import fs from 'fs';
import path from 'path';
import { logger } from '@codesense/shared';

// ── Constants ─────────────────────────────────────────────────────────────────

// File extensions we skip — binary files, lock files, generated files
// Reviewing these would waste AI tokens and produce useless comments
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.tar', '.gz',
]);

// File names we always skip
const SKIP_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
]);

// Max characters of diff to send to AI
// Gemini 1.5 Flash supports 1M tokens, but more focused diffs = better reviews
// ~12,000 chars ≈ 3,000 tokens — covers most PRs cleanly
const MAX_DIFF_CHARS = 12_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PullRequestFile {
  filename: string;
  patch: string;          // The actual diff text (unified diff format)
  additions: number;
  deletions: number;
  status: string;         // 'added', 'modified', 'deleted', 'renamed'
}

// ── Service ───────────────────────────────────────────────────────────────────

export class DiffService {
  /**
   * Reads the GitHub App private key from the path set in config.ts.
   * The path is already resolved to absolute in config.ts.
   */
  private getPrivateKey(): string {
    const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH!;
    return fs.readFileSync(keyPath, 'utf8');
  }

  /**
   * Generates a GitHub installation access token.
   *
   * This token lets us make API calls to a specific repository
   * where the user installed our GitHub App.
   */
  async getInstallationToken(installationId: number): Promise<string> {
    const auth = createAppAuth({
      appId: parseInt(process.env.GITHUB_APP_ID!, 10),
      privateKey: this.getPrivateKey(),
      installationId,
    });

    // createAppAuth handles JWT generation + token exchange automatically
    const { token } = await auth({ type: 'installation' });
    return token;
  }

  /**
   * Fetches the list of changed files in a Pull Request.
   *
   * GitHub API: GET /repos/{owner}/{repo}/pulls/{pull_number}/files
   * Returns: array of file objects with filename, status, and patch (diff text)
   */
  async fetchPRFiles(
    owner: string,
    repo: string,
    prNumber: number,
    installationId: number
  ): Promise<PullRequestFile[]> {
    logger.info('Fetching PR files from GitHub', { owner, repo, prNumber });

    const token = await this.getInstallationToken(installationId);

    // Octokit is GitHub's official API client for JavaScript/TypeScript
    const octokit = new Octokit({ auth: token });

    const { data: files } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100, // max 100 files per request (GitHub API limit)
    });

    // Filter out files we can't meaningfully review
    const reviewableFiles = files
      .filter(file => {
        // Binary files have no patch (diff text)
        if (!file.patch) return false;

        const ext = path.extname(file.filename).toLowerCase();
        const basename = path.basename(file.filename);

        // Skip binary/lock/generated files
        if (SKIP_EXTENSIONS.has(ext)) return false;
        if (SKIP_FILENAMES.has(basename)) return false;

        // Skip minified files (.min.js, .min.css)
        if (basename.includes('.min.')) return false;

        return true;
      })
      .map(file => ({
        filename: file.filename,
        patch: file.patch!,
        additions: file.additions,
        deletions: file.deletions,
        status: file.status,
      }));

    logger.info('PR files fetched and filtered', {
      owner,
      repo,
      prNumber,
      totalFiles: files.length,
      reviewableFiles: reviewableFiles.length,
      skipped: files.length - reviewableFiles.length,
    });

    return reviewableFiles;
  }

  /**
   * Combines all file diffs into a single string for the AI.
   *
   * The unified diff format looks like:
   *   +++ b/src/auth.ts
   *   @@ -10,5 +10,8 @@
   *   -  const token = req.query.token;
   *   +  const token = req.headers['authorization'];
   *
   * We format each file with a header so the AI knows which file it's looking at.
   * If the total diff is too large, we truncate (AI has context limits).
   */
  buildDiffString(files: PullRequestFile[]): { diff: string; truncated: boolean } {
    let diff = '';
    let totalChars = 0;
    let truncated = false;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const section = [
        `\n${'─'.repeat(60)}`,
        `File: ${file.filename} [${file.status}] (+${file.additions} -${file.deletions})`,
        `${'─'.repeat(60)}`,
        file.patch,
        '',
      ].join('\n');

      if (totalChars + section.length > MAX_DIFF_CHARS) {
        const remaining = files.length - i;
        diff += `\n[... ${remaining} more file(s) not shown due to size limits ...]`;
        truncated = true;
        break;
      }

      diff += section;
      totalChars += section.length;
    }

    return { diff, truncated };
  }
}
