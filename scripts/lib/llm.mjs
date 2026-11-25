import { execFileSync } from 'node:child_process'
import { findingIsInDiff } from './diff.mjs'

const SYSTEM = 'You are a careful code reviewer. Return strict JSON only.'

export async function complete(prompt, options = {}) {
  const maxTokens = options.maxTokens || 20000
  if (process.env.ANTHROPIC_API_KEY) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'claude-sonnet-4-5',
        max_tokens: maxTokens,
        system: options.system || SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(60000),
    })
    if (!response.ok) throw new Error(`LLM API HTTP ${response.status}`)
    const data = await response.json()
    return (data.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('')
  }

  if (process.env.CLAUDE_SHIP_ENGINE === 'hermes') {
    const model = process.env.LLM_MODEL || 'tencent/hy4-flash:free'
    return execFileSync('hermes', ['-z', `${options.system || SYSTEM}\n\n${prompt}`, '-m', model], {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    })
  }
  return null
}

export function parseFindings(text) {
  const match = String(text || '').match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Deterministic baseline reviewer, used when no LLM key is configured. */
export function heuristicFindings(parsedDiff) {
  const findings = []
  for (const file of parsedDiff) {
    for (const change of file.added) {
      const text = change.text
      if (/\b(TODO|FIXME|XXX)\b/.test(text)) {
        findings.push({ file: file.path, line: change.line, severity: 'info', category: 'maintainability', title: 'Unresolved marker in new code', detail: `Added line contains ${text.match(/\b(TODO|FIXME|XXX)\b/)[0]}.`, confidence: 0.9 })
      }
      if (/console\.log\s*\(/.test(text)) {
        findings.push({ file: file.path, line: change.line, severity: 'warning', category: 'correctness', title: 'Debug logging added', detail: 'A console.log statement was added to production code.', confidence: 0.8 })
      }
      const secret = text.match(/(api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9]{12,}/i)
      if (secret) {
        findings.push({ file: file.path, line: change.line, severity: 'critical', category: 'security', title: 'Possible hardcoded credential', detail: 'A credential-like literal was added; use an environment variable instead.', confidence: 0.95 })
      }
    }
  }
  return findings
}

const LEVELS = { quick: 4000, standard: 20000, deep: 60000 }

export async function reviewDiff(diffText, parsedDiff, level = 'standard', limits = {}) {
  const maxFindings = limits.max_findings || 20
  const prompt = `Review this pull request diff for correctness, security, performance and maintainability.
Review level: ${level}. Return STRICT JSON array of findings only, max ${maxFindings} items, each:
{"file":"path","line":number,"severity":"critical|warning|info","category":"security|correctness|performance|maintainability","title":"short","detail":"why and how to fix","confidence":0-1}
Only report issues visible in the added lines. Do not report style preferences.
DIFF:
${diffText}`

  let findings = null
  try {
    const raw = await complete(prompt, { maxTokens: limits.max_tokens || LEVELS[level] || 20000 })
    findings = parseFindings(raw)
  } catch {
    findings = null
  }
  if (!findings) findings = heuristicFindings(parsedDiff)

  // Adversarial verification: drop findings that are not grounded in added lines.
  const grounded = findings.filter((finding) => findingIsInDiff(finding, parsedDiff))
  if (grounded.length && process.env.ANTHROPIC_API_KEY) {
    try {
      const verifyPrompt = `Adversarially verify these code review findings against the diff. Remove false positives. Return strict JSON array of the surviving findings only.\nDIFF:\n${diffText}\nFINDINGS:\n${JSON.stringify(grounded)}`
      const raw = await complete(verifyPrompt, { maxTokens: 4000 })
      const verified = parseFindings(raw)
      if (verified) return verified.filter((f) => findingIsInDiff(f, parsedDiff)).slice(0, maxFindings)
    } catch {
      /* keep grounded findings */
    }
  }
  return grounded.slice(0, maxFindings)
}
