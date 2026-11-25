import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

function token() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
}

export function gh(args, options = {}) {
  const env = { ...process.env }
  if (token()) env.GH_TOKEN = token()
  return execFileSync('gh', args, { encoding: 'utf8', env, ...options })
}

export function api(endpoint, options = {}) {
  const args = ['api', endpoint]
  if (options.method) args.push('--method', options.method)
  if (options.input) args.push('--input', options.input)
  if (options.json) args.push('--input', '-')
  try {
    if (options.json) {
      const env = { ...process.env }
      if (token()) env.GH_TOKEN = token()
      return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', input: JSON.stringify(options.json), env }))
    }
    return JSON.parse(gh(args))
  } catch {
    return null
  }
}

export function eventPayload() {
  const file = process.env.GITHUB_EVENT_PATH
  if (!file || !fs.existsSync(file)) return {}
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} }
}

export function context() {
  const repo = process.env.GITHUB_REPOSITORY || ''
  const event = eventPayload()
  const prNumber = Number(process.env.PR_NUMBER || event.pull_request?.number || event.issue?.number || 0)
  return { repo, event, eventName: process.env.GITHUB_EVENT_NAME || '', prNumber }
}

export function prInfo(repo, number) {
  return api(`repos/${repo}/pulls/${number}`)
}

export function prFiles(repo, number) {
  return api(`repos/${repo}/pulls/${number}/files?per_page=100`) || []
}

export function prComments(repo, number) {
  return api(`repos/${repo}/issues/${number}/comments?per_page=100`) || []
}

export function postComment(repo, number, body) {
  const tmp = pathFor('comment')
  fs.writeFileSync(tmp, JSON.stringify({ body }), 'utf8')
  return api(`repos/${repo}/issues/${number}/comments`, { method: 'POST', input: tmp })
}

export function submitReview(repo, number, event, body, comments = []) {
  const tmp = pathFor('review')
  fs.writeFileSync(tmp, JSON.stringify({ event, body, comments }), 'utf8')
  return api(`repos/${repo}/pulls/${number}/reviews`, { method: 'POST', input: tmp })
}

export function failingChecks(repo, ref) {
  const data = api(`repos/${repo}/commits/${encodeURIComponent(ref)}/check-runs`)
  return (data?.check_runs || []).filter((run) => run.status === 'completed' && run.conclusion !== 'success')
}

export function pathFor(kind) {
  const dir = process.env.RUNNER_TEMP || process.cwd()
  const file = `${dir}/claude-ship-${kind}-${process.pid}.json`
  return file
}

export function latestDirective(comments, marker = '@claude') {
  for (const comment of [...comments].reverse()) {
    const body = String(comment.body || '')
    if (body.includes('@claude stop')) return 'stop'
    if (body.includes(marker)) return 'run'
  }
  return 'none'
}
