// ─────────────────────────────────────────────────────────────────────────────
// GitHub Webhook Payload Types
//
// When GitHub sends a webhook, the request body matches these shapes.
// We only define the fields we actually USE — GitHub sends much more data
// but TypeScript only needs the subset we care about.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The shape of GitHub's pull_request webhook payload.
 *
 * GitHub sends this when a PR is:
 *   - opened
 *   - synchronize (new commit pushed to the PR branch)
 *   - reopened
 *   - closed
 *   - and many other actions we don't care about
 *
 * Reference: https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
 */
export interface GitHubPullRequestWebhook {
  // What happened: "opened", "closed", "synchronize", "reopened", etc.
  action: string;

  // The PR number (e.g. 42 for github.com/user/repo/pull/42)
  number: number;

  pull_request: {
    title: string;
    state: 'open' | 'closed';
    head: {
      sha: string;   // The latest commit SHA on the PR branch — used for deduplication
      ref: string;   // Branch name (e.g. "feat/add-auth")
    };
    base: {
      ref: string;   // Target branch name (e.g. "main")
    };
    user: {
      login: string; // GitHub username of the person who opened the PR
    };
  };

  repository: {
    name: string;         // Repo name (e.g. "my-project")
    full_name: string;    // "owner/repo" format (e.g. "KrishnaGupta1111/my-project")
    owner: {
      login: string;      // Owner's GitHub username
    };
    private: boolean;     // Is the repo private?
  };

  // The GitHub App installation on this repo
  // We need the installation.id to generate an access token to post comments
  installation: {
    id: number;
  };
}

/**
 * GitHub App installation event payload.
 * Fired when a user installs or uninstalls our GitHub App on their repos.
 */
export interface GitHubInstallationWebhook {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend' | 'new_permissions_accepted';
  installation: {
    id: number;
    account: {
      login: string;
      type: 'User' | 'Organization';
    };
  };
  repositories?: Array<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
  }>;
}
