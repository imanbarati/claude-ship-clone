/**
 * Parse a unified diff into files and added-line maps without dependencies.
 */
export function parseDiff(text) {
  const files = []
  let current = null
  let oldLine = 0
  let newLine = 0
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      current = { path: match ? match[2] : 'unknown', added: [], removed: [], hunks: [] }
      files.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      current.hunks.push({ oldLine, newLine })
      continue
    }
    if (line.startsWith('+')) {
      current.added.push({ line: newLine, text: line.slice(1) })
      newLine++
    } else if (line.startsWith('-')) {
      current.removed.push({ line: oldLine, text: line.slice(1) })
      oldLine++
    } else if (!line.startsWith('\\')) {
      oldLine++
      newLine++
    }
  }
  return files
}

export function changedPaths(files) {
  return files.map((file) => file.path)
}

export function diffLineCount(files) {
  return files.reduce((sum, file) => sum + file.added.length + file.removed.length, 0)
}

export function diffToPrompt(files, maxChars = 60000) {
  const text = String(files || '')
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n… (diff truncated by limit)'
}

export function findingIsInDiff(finding, files) {
  const file = files.find((f) => f.path === finding?.file || f.path.endsWith(`/${finding?.file}`))
  if (!file) return false
  if (!finding.line) return true
  return file.added.some((line) => Math.abs(line.line - Number(finding.line)) <= 3)
}
