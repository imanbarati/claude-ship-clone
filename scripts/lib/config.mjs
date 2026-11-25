import fs from 'node:fs'
import path from 'node:path'

const DEFAULTS = {
  review_level: 'standard',
  review_on: ['opened', 'synchronize', 'reopened'],
  steward: { enabled: true, max_attempts: 3, on: ['check_failure', 'merge_conflict', 'review_feedback', 'mention'] },
  approvals: { enabled: true },
  limits: { max_prompt_chars: 60000, max_findings: 20, max_tokens: 20000 },
}

function scalar(value) {
  const v = String(value).trim().replace(/\s+#.*$/, '')
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1).replace(/\\\\/g, '\\').replace(/\\"/g, '"')
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((s) => scalar(s)).filter(Boolean)
  if (/^\d+$/.test(v)) return Number(v)
  if (v === 'true') return true
  if (v === 'false') return false
  return v
}

/** Minimal YAML reader for the flat config/policy shapes this app uses. */
export function parseSimpleYaml(text) {
  const root = {}
  let currentKey = null
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indent = raw.match(/^\s*/)[0].length
    const line = raw.trim()
    if (line.startsWith('- ')) {
      const entry = line.slice(2)
      if (!Array.isArray(root[currentKey])) root[currentKey] = []
      if (entry.includes(':')) {
        const [k, ...rest] = entry.split(':')
        const obj = { [k.trim()]: scalar(rest.join(':')) }
        root[currentKey].push(obj)
      } else {
        root[currentKey].push(scalar(entry))
      }
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (indent === 0) {
      currentKey = key
      if (value === '') root[key] = {}
      else root[key] = scalar(value)
    } else if (Array.isArray(root[currentKey]) && root[currentKey].length) {
      Object.assign(root[currentKey][root[currentKey].length - 1], { [key]: scalar(value) })
    } else if (root[currentKey] && typeof root[currentKey] === 'object') {
      root[currentKey][key] = scalar(value)
    }
  }
  return root
}

export function loadYaml(file, fallback = {}) {
  try {
    return parseSimpleYaml(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'))
  } catch {
    return fallback
  }
}

export function loadConfig() {
  const loaded = loadYaml('.claude-ship/config.yml', {})
  return {
    ...DEFAULTS,
    ...loaded,
    steward: { ...DEFAULTS.steward, ...(loaded.steward || {}) },
    approvals: { ...DEFAULTS.approvals, ...(loaded.approvals || {}) },
    limits: { ...DEFAULTS.limits, ...(loaded.limits || {}) },
  }
}

export function loadPolicy() {
  const loaded = loadYaml('.claude-ship/policy.yml', {})
  return {
    mode: loaded.mode === 'enforce' ? 'enforce' : 'observe',
    review: { required: Boolean(loaded.review?.required) },
    rules: Array.isArray(loaded.rules) ? loaded.rules : [],
    classifiers: Array.isArray(loaded.classifiers) ? loaded.classifiers : [],
  }
}
