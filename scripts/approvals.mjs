#!/usr/bin/env node
import { context, prInfo, prFiles, prComments, postComment, submitReview, latestDirective } from './lib/github.mjs'
import { loadConfig, loadPolicy } from './lib/config.mjs'
import { parseDiff, diffLineCount, changedPaths } from './lib/diff.mjs'
import { evaluatePolicy } from './lib/policy.mjs'
import { parseFindings, heuristicFindings } from './lib/llm.mjs'
import fs from 'node:fs'

async function main() {
  const config = loadConfig()
  const policy = loadPolicy()
  const { repo, prNumber, event } = context()
  if (!repo || !prNumber) return console.log('claude-ship approvals: no PR context; skipping.')

  const pr = prInfo(repo, prNumber)
  if (!pr) return console.error('claude-ship approvals: could not read PR.')

  const files = prFiles(repo, prNumber)
  const diffText = files.map((file) => file.patch || '').join('\n')
  const parsed = parseDiff(diffText)
  const comments = prComments(repo, prNumber)

  // Reuse the latest Code Review findings when present, else use baseline signals.
  let findings = []
  for (const comment of [...comments].reverse()) {
    const parsedFindings = parseFindings(comment.body || '')
    if (parsedFindings) { findings = parsedFindings; break }
  }
  if (!findings.length) findings = heuristicFindings(parsed)

  const result = evaluatePolicy(policy, {
    diffText,
    paths: changedPaths(parsed),
    lines: diffLineCount(parsed),
    labels: (pr.labels || []).map((label) => label.name),
    findings,
  })

  const body = `## Claude Ship — approvals (${policy.mode})\n\n**Decision:** ${result.decision}\n\n${result.reason}\n\nRules: ${(policy.rules || []).map((r) => r.name).join(', ') || 'none'}.`
  if (policy.mode === 'observe') {
    postComment(repo, prNumber, body)
    console.log(`claude-ship approvals (observe): ${result.decision}`)
    return
  }

  const eventName = result.decision === 'approve' ? 'APPROVE' : result.decision === 'request_changes' ? 'REQUEST_CHANGES' : 'COMMENT'
  const submitted = submitReview(repo, prNumber, eventName, body)
  if (!submitted) postComment(repo, prNumber, body + '\n\n_The review submission was not accepted; falling back to a comment._')
  console.log(`claude-ship approvals (enforce): ${result.decision}`)
}

await main()
