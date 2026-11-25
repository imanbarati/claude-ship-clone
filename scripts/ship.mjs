#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { gh, context } from './lib/github.mjs'

function run(args) {
  return execFileSync(args[0], args.slice(1), { encoding: 'utf8' })
}

const message = process.argv.slice(2).join(' ') || 'chore: ship changes'
const dirty = run(['git', 'status', '--porcelain']).trim()
if (dirty) {
  run(['git', 'add', '-A'])
  run(['git', 'commit', '-m', message])
}
const branch = run(['git', 'rev-parse', '--abbrev-ref', 'HEAD']).trim()
run(['git', 'push', '-u', 'origin', branch])
let prUrl = ''
try { prUrl = gh(['pr', 'view', '--json', 'url', '--jq', '.url']).trim() } catch { /* none yet */ }
if (!prUrl) prUrl = gh(['pr', 'create', '--fill', '--title', message]).trim()
console.log(`Shipped ${branch}: ${prUrl}`)
console.log('Code Review, PR Steward and Claude Approvals will run through GitHub Actions.')
