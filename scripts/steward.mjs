#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { context, gh, prInfo, prComments, postComment, latestDirective, failingChecks } from './lib/github.mjs'
import { loadConfig } from './lib/config.mjs'
import { complete } from './lib/llm.mjs'

const config = loadConfig()
const { repo, prNumber, eventName, event } = context()
if (!config.steward.enabled) process.exit(0)
if (!repo || !prNumber) {
  console.log('claude-ship steward: no PR context; skipping.')
  process.exit(0)
}

const pr = prInfo(repo, prNumber)
if (!pr) process.exit(1)
const comments = prComments(repo, prNumber)
const directive = latestDirective(comments)
if (directive === 'stop') {
  postComment(repo, prNumber, 'Claude Ship PR Steward is stepping back. Comment `@claude` to resume.')
  process.exit(0)
}

const failures = failingChecks(repo, pr.head?.sha || '')
const conflicted = pr.mergeable_state === 'dirty' || pr.mergeable === false
const feedback = comments.filter((c) => String(c.body || '').includes('@claude')).length
const failedWorkflow = eventName === 'workflow_run' && event.workflow_run?.conclusion === 'failure'
const attempts = comments.filter((c) => String(c.body || '').includes('Claude Ship — PR Steward update')).length

if (!failures.length && !conflicted && !feedback && !failedWorkflow) {
  console.log('claude-ship steward: nothing to fix.')
  process.exit(0)
}
if (attempts >= Number(config.steward.max_attempts || 3)) {
  postComment(repo, prNumber, 'Claude Ship — PR Steward reached the configured attempt limit. A human should take over.')
  process.exit(0)
}

function run(args, opts = {}) {
  return execFileSync(args[0], args.slice(1), { encoding: 'utf8', ...opts })
}

let changes = []
try {
  run(['git', 'fetch', 'origin', `pull/${prNumber}/head:claude-ship-pr-${prNumber}`], { stdio: 'ignore' })
  run(['git', 'checkout', '-B', `claude-ship-pr-${prNumber}`], { stdio: 'ignore' })
  const changed = run(['git', 'diff', '--name-only', 'origin/' + (pr.base?.ref || 'main')]).trim().split('\n').filter(Boolean)

  // LLM patch first; deterministic whitespace fixes as the baseline fallback.
  let applied = false
  try {
    const patch = await complete(`Fix the failing CI / review feedback for this PR. Return ONLY a unified git diff patch.\nFailures: ${JSON.stringify(failures)}\nConflicted: ${conflicted}\nFeedback: ${feedback}\nFiles: ${changed.join(', ')}`, { maxTokens: 8000 })
    if (patch && patch.includes('diff --git')) {
      fs.writeFileSync('claude-ship.patch', patch, 'utf8')
      run(['git', 'apply', 'claude-ship.patch'], { stdio: 'ignore' })
      fs.unlinkSync('claude-ship.patch')
      applied = true
      changes = ['Applied an automated patch from the review engine.']
    }
  } catch { /* fall through to baseline fixes */ }

  if (!applied) {
    for (const file of changed) {
      if (!fs.existsSync(file)) continue
      const original = fs.readFileSync(file, 'utf8')
      let fixed = original.split(/\r?\n/).map((line) => line.replace(/[ \t]+$/, '')).join('\n')
      if (!fixed.endsWith('\n')) fixed += '\n'
      if (fixed !== original) { fs.writeFileSync(file, fixed, 'utf8'); changes.push(`Removed trailing whitespace / added final newline in ${file}.`) }
    }
  }

  if (!changes.length) {
    postComment(repo, prNumber, 'Claude Ship — PR Steward update\n\nNo safe automatic fix found for the current failures.')
    process.exit(0)
  }

  run(['git', 'add', '-A'], { stdio: 'ignore' })
  run(['git', '-c', 'user.name=claude-ship-bot', '-c', 'user.email=claude-ship@users.noreply.github.com', 'commit', '-m', 'fix: PR Steward automated corrections'], { stdio: 'ignore' })
  const sha = run(['git', 'rev-parse', '--short', 'HEAD']).trim()
  run(['git', 'push', 'origin', `HEAD:refs/heads/${pr.head?.ref || `claude-ship-pr-${prNumber}`}`], { stdio: 'ignore' })
  postComment(repo, prNumber, `Claude Ship — PR Steward update\n\n${changes.map((c) => `- ${c}`).join('\n')}\n\nUndo with \`git revert ${sha}\`.`)
  console.log(`claude-ship steward: pushed ${sha} with ${changes.length} change(s).`)
} catch (error) {
  postComment(repo, prNumber, `Claude Ship — PR Steward update\n\nAutomatic fix failed: ${error.message}`)
  console.error('claude-ship steward failed:', error.message)
}
