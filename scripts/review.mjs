#!/usr/bin/env node
import { context, prInfo, prFiles, postComment, submitReview } from './lib/github.mjs'
import { loadConfig } from './lib/config.mjs'
import { parseDiff, diffLineCount } from './lib/diff.mjs'
import { reviewDiff } from './lib/llm.mjs'

const config = loadConfig()
const { repo, prNumber, eventName, event } = context()

if (!repo || !prNumber) {
  console.log('claude-ship review: no pull request in context; skipping.')
  process.exit(0)
}
if ((config.review_on || []).length && !config.review_on.includes(eventName)) {
  console.log(`claude-ship review: event ${eventName} not configured; skipping.`)
  process.exit(0)
}

const pr = prInfo(repo, prNumber)
if (!pr) {
  console.error('claude-ship review: could not read the pull request.')
  process.exit(1)
}
if (pr.draft) {
  console.log('claude-ship review: draft PR; skipping.')
  process.exit(0)
}

const files = prFiles(repo, prNumber)
const diffText = files.map((file) => file.patch || '').filter(Boolean).join('\n')
const parsed = parseDiff(diffText)
const findings = await reviewDiff(diffText, parsed, config.review_level, config.limits)

const header = `## Claude Ship — ${config.review_level} review\n\n${findings.length} finding(s) across ${parsed.length} file(s), ${diffLineCount(parsed)} changed lines.\n`
const body = findings.length
  ? header + '\n' + findings.map((f, i) => `${i + 1}. **${f.severity || 'info'} · ${f.category || 'general'}** — ${f.title}\n   \`${f.file}:${f.line || '?'}\` — ${f.detail}`).join('\n') + '\n\n_Reviewed by Claude Ship clone. Findings may miss issues._'
  : header + '\nNo blocking findings detected.\n'

const comments = findings
  .filter((finding) => finding.file && finding.line)
  .slice(0, 10)
  .map((finding) => ({ path: finding.file, line: Number(finding.line), side: 'RIGHT', body: `**${finding.severity || 'info'}** ${finding.title} — ${finding.detail}` }))

const review = submitReview(repo, prNumber, 'COMMENT', body, comments)
if (!review) postComment(repo, prNumber, body)
console.log(`claude-ship review: posted ${findings.length} finding(s) on ${repo}#${prNumber}.`)
