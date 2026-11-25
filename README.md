# Claude Ship — functional open-source clone

A dependency-free implementation of the workflow described in
[Introducing Claude Ship](https://claude.com/resources/articles/introducing-claude-ship):
open a pull request, then let agents review it, fix it, and decide whether it is
ready to merge. This is an independent clone, not affiliated with Anthropic.

## Feature fidelity

| Claude Ship capability | This repo |
|---|---|
| Code Review, Quick / Standard / Deep, multi-lens findings, adversarial verification, inline PR comments | `scripts/review.mjs`, `.github/workflows/code-review.yml`, `review_level` in config |
| PR Steward: failing CI, merge conflicts, review feedback, fixes pushed with an undo note, `@claude` / `@claude stop` | `scripts/steward.mjs`, `.github/workflows/steward.yml` |
| Claude Approvals: repository policy file, observe / enforce, approve or request changes, review-findings signal | `scripts/approvals.mjs`, `.claude-ship/policy.yml`, `.github/workflows/approvals.yml` |
| `/ship`: push, open the PR, let the agents work | `npm run ship` (`scripts/ship.mjs`) |
| Admin settings per repository | `.claude-ship/config.yml` (review level, triggers, limits, agent toggles) |
| Teams keep existing branch protection and required checks | Reviews and approvals are ordinary GitHub PR reviews/checks |

Not reproduced: billing, spend metering, Claude Team/Enterprise administration,
Zero Data Retention restrictions and the hosted dashboard. The dashboard here is
a small public status page, not an enterprise admin console.

## How review works

1. `review.mjs` reads the PR diff through `gh api`.
2. It asks an LLM (Anthropic Messages API) for structured findings, or falls back
   to a deterministic reviewer (hardcoded credentials, debug logging, TODO markers).
3. Every finding is verified against **added lines only**; with an LLM key, a
   second adversarial pass removes false positives.
4. Findings are posted as inline PR review comments plus a summary.
5. `review_level` controls the prompt/token budget: quick / standard / deep.

## Install

1. Fork or use this repository as a template, then push to GitHub.
2. Repository secrets:
   - `ANTHROPIC_API_KEY` (optional) — enables LLM review and patches. Without it,
     the deterministic baseline reviewer and whitespace fixes still run.
   - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` — only for dashboard deploy.
3. Repository variables (optional): `LLM_MODEL` (default `claude-sonnet-4-5`),
   `CLAUDE_SHIP_ENGINE` (`hermes` to use a local Hermes CLI instead of the API).
4. Edit `.claude-ship/config.yml` and `.claude-ship/policy.yml`.
5. Open a pull request. CI, Code Review and Claude Approvals run automatically;
   PR Steward reacts to failures, conflicts and `@claude` comments.

Workflows need `pull-requests: write` and `contents: write`, already declared.

## Configuration

`.claude-ship/config.yml`:

```yaml
review_level: standard          # quick | standard | deep
review_on: [opened, synchronize, reopened]
steward:
  enabled: true
  max_attempts: 3
approvals:
  enabled: true
limits:
  max_findings: 20
  max_tokens: 20000
```

`.claude-ship/policy.yml` starts in **observe** mode (comments only). Set
`mode: enforce` to submit real `APPROVE` / `REQUEST_CHANGES` reviews. Rules
supported: `diff_contains_pattern`, `paths_match`, `diff_lines_less_than`,
`labels_include`, `review_clean`; actions: `approve`, `request_changes`.

## Local use and tests

```bash
npm test                       # 9 unit tests, no network
npm run review                 # review the current PR (needs gh + PR context)
npm run approvals              # evaluate the policy against the current PR
npm run steward                # run one steward pass
npm run ship "feat: my change" # commit, push, open PR
```

The scripts use the `gh` CLI, so `gh auth login` is enough locally. In Actions
they use `GITHUB_TOKEN`. No npm dependencies are installed at runtime.

## Dashboard / Cloudflare

`dashboard/` is a static status page (GitHub public API only). Pushing to `main`
runs `.github/workflows/deploy-dashboard.yml`, which deploys it with
`wrangler pages deploy` on Cloudflare's free tier. If the Cloudflare secrets are
missing, the deploy step skips with a notice instead of failing the build.

## Honest limitations

- LLM calls require your own API key; the fallback catches only common issues.
- PR Steward's baseline patching is deliberately conservative (whitespace and
  final newline). With an LLM key it can apply a generated unified diff.
- `@claude stop` is read from PR comments; there is no persistent state service.
- Claude Approvals cannot bypass GitHub branch protection; add its check as a
  required review in repository settings when you trust the policy.

Verification performed: all Node files pass `node --check`; `npm test` passes 9/9;
the workflows and dashboard were pushed to GitHub and exercised with a real PR.
