// ─────────────────────────────────────────────────────────────────────────────
// Review Prompt Templates
//
// The quality of AI output depends almost entirely on the quality of the prompt.
// This is called "prompt engineering" — a real skill that companies hire for.
//
// KEY PRINCIPLES USED HERE:
// 1. Role assignment — "You are an expert senior engineer" makes the AI
//    respond more technically and precisely than a generic request.
//
// 2. Critical Rules section — explicitly forbids markdown, enforces JSON-only
//    output. Without this, Gemini wraps the JSON in markdown code fences (```)
//    which breaks JSON.parse().
//
// 3. Schema example — showing the exact structure the AI must return
//    is more reliable than describing it in prose.
//
// 4. Score guidelines — without this, AI scores are inconsistent. Defining
//    what "100" and "0" mean anchors the model's output.
// ─────────────────────────────────────────────────────────────────────────────

export function buildReviewPrompt(
  prTitle: string,
  owner: string,
  repo: string,
  diff: string
): string {
  return `You are an expert senior software engineer performing a thorough code review.

CRITICAL RULES — follow these exactly:
1. Return ONLY valid JSON. Zero markdown. Zero code fences. Zero explanation text outside JSON.
2. Every comment MUST reference a real filename visible in the diff below.
3. Line numbers must be positive integers visible in the diff context.
4. Be specific and actionable — the suggestion field must contain corrected code, not advice.
5. If the code looks good overall, return an empty comments array with high scores.
6. Focus on real bugs, security issues, and performance problems — NOT style preferences.

PR Title: ${prTitle}
Repository: ${owner}/${repo}

Carefully review this diff:

${diff}

Return EXACTLY this JSON structure. Nothing else. No wrapper, no explanation:
{
  "summary": "2-3 sentences: what does this PR do and what is your overall quality assessment",
  "score": {
    "quality": <integer 0-100, where 100=excellent code, 0=very poor>,
    "security": <integer 0-100, where 100=no vulnerabilities found, 0=critical holes>,
    "performance": <integer 0-100, where 100=optimal, 0=serious performance issues>,
    "overall": <integer 0-100, weighted average: security 40% + quality 35% + performance 25%>
  },
  "comments": [
    {
      "file": "exact/path/to/file.ts",
      "line": <integer>,
      "severity": "critical",
      "category": "security",
      "message": "SQL query is built with string concatenation making it vulnerable to SQL injection. An attacker can input ' OR 1=1 -- to dump all data.",
      "suggestion": "Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [userId])"
    }
  ]
}

Valid severity values: critical, warning, suggestion
Valid category values: security, performance, quality`;
}
