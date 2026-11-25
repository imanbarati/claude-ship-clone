/**
 * Evaluate a Claude Approvals policy against PR signals.
 * Pure function so it can be unit-tested without GitHub access.
 */
function ruleMatches(rule, input) {
  const pattern = rule.pattern ? String(rule.pattern) : ''
  switch (rule.when) {
    case 'diff_contains_pattern':
      try { return new RegExp(pattern, 'i').test(input.diffText || '') } catch { return false }
    case 'paths_match':
      try { return (input.paths || []).some((path) => new RegExp(pattern).test(path)) } catch { return false }
    case 'diff_lines_less_than':
      return Number(input.lines || 0) < Number(rule.value || 0)
    case 'labels_include':
      return (input.labels || []).includes(String(rule.value || rule.pattern || ''))
    case 'review_clean':
      return (input.findings || []).length === 0
    default:
      return false
  }
}

export function evaluatePolicy(policy, input) {
  const blockers = []
  const approvals = []
  for (const rule of policy.rules || []) {
    if (!ruleMatches(rule, input)) continue
    if (rule.action === 'request_changes') blockers.push(rule.name || 'unnamed rule')
    if (rule.action === 'approve') approvals.push(rule.name || 'unnamed rule')
  }
  if (blockers.length) {
    return { decision: 'request_changes', blockers, approvals, reason: `Blocked by: ${blockers.join(', ')}` }
  }
  if (approvals.length && !(policy.review && policy.review.required && (input.findings || []).length)) {
    return { decision: 'approve', blockers, approvals, reason: `Allowed by: ${approvals.join(', ')}` }
  }
  return { decision: 'comment_only', blockers, approvals, reason: 'No approval rule matched; human review required.' }
}
