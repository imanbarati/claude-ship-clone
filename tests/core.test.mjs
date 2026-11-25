import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSimpleYaml, loadConfig, loadPolicy } from '../scripts/lib/config.mjs'
import { parseDiff, changedPaths, diffLineCount, findingIsInDiff } from '../scripts/lib/diff.mjs'
import { heuristicFindings, parseFindings } from '../scripts/lib/llm.mjs'
import { evaluatePolicy } from '../scripts/lib/policy.mjs'

const DIFF = `diff --git a/src/app.js b/src/app.js
index 111..222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,4 @@
 const x = 1
+console.log('debug')
+const api_key = "abcdefghijklmnop"
 export default x
`

test('YAML parser reads scalars, lists and list-of-maps', () => {
  const parsed = parseSimpleYaml('mode: enforce\nreview:\n  required: true\nrules:\n  - name: docs\n    when: paths_match\n    pattern: "docs/"\n    action: approve\n')
  assert.equal(parsed.mode, 'enforce')
  assert.equal(parsed.review.required, true)
  assert.equal(parsed.rules[0].name, 'docs')
  assert.equal(parsed.rules[0].pattern, 'docs/')
})

test('config and policy load with defaults', () => {
  const config = loadConfig()
  assert.equal(config.review_level, 'standard')
  assert.equal(config.limits.max_findings, 20)
  const policy = loadPolicy()
  assert.equal(policy.mode, 'observe')
  assert.ok(policy.rules.length >= 2)
})

test('diff parsing maps added lines and paths', () => {
  const files = parseDiff(DIFF)
  assert.deepEqual(changedPaths(files), ['src/app.js'])
  assert.equal(diffLineCount(files), 2)
  assert.deepEqual(files[0].added.map((l) => l.line), [2, 3])
})

test('heuristic reviewer finds debug logs and credentials', () => {
  const findings = heuristicFindings(parseDiff(DIFF))
  assert.ok(findings.some((f) => f.category === 'security'))
  assert.ok(findings.some((f) => f.category === 'correctness'))
})

test('findings are verified against added lines only', () => {
  const files = parseDiff(DIFF)
  assert.equal(findingIsInDiff({ file: 'src/app.js', line: 2 }, files), true)
  assert.equal(findingIsInDiff({ file: 'src/app.js', line: 99 }, files), false)
  assert.equal(findingIsInDiff({ file: 'other.js', line: 2 }, files), false)
})

test('parseFindings extracts a JSON array from chatty model output', () => {
  assert.deepEqual(parseFindings('Here you go:\n[{"file":"a.js","line":1}]'), [{ file: 'a.js', line: 1 }])
  assert.equal(parseFindings('no json'), null)
})

test('policy blocks secrets even when other rules approve', () => {
  const policy = { mode: 'enforce', review: { required: false }, rules: [
    { name: 'secret', when: 'diff_contains_pattern', pattern: 'api_key', action: 'request_changes' },
    { name: 'small', when: 'diff_lines_less_than', value: 100, action: 'approve' },
  ] }
  const result = evaluatePolicy(policy, { diffText: DIFF, paths: ['src/app.js'], lines: 2, labels: [] })
  assert.equal(result.decision, 'request_changes')
})

test('policy approves small docs-only changes', () => {
  const policy = { mode: 'enforce', review: { required: false }, rules: [
    { name: 'docs', when: 'paths_match', pattern: '(^|/)docs/', action: 'approve' },
  ] }
  const result = evaluatePolicy(policy, { diffText: '', paths: ['docs/guide.md'], lines: 4, labels: [] })
  assert.equal(result.decision, 'approve')
})

test('review-required policy keeps a clean-looking diff in comment_only', () => {
  const policy = { mode: 'observe', review: { required: true }, rules: [
    { name: 'small', when: 'diff_lines_less_than', value: 100, action: 'approve' },
  ] }
  const result = evaluatePolicy(policy, { diffText: '', paths: ['src/a.js'], lines: 4, labels: [], findings: [{ title: 'issue' }] })
  assert.equal(result.decision, 'comment_only')
})
