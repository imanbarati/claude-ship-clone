const grid = document.getElementById('status-grid')
const endpoint = 'https://api.github.com/repos/imanbarati/claude-ship-clone'

async function load() {
  try {
    const [repo, prs] = await Promise.all([
      fetch(endpoint, { headers: { Accept: 'application/vnd.github+json' } }).then((r) => r.json()),
      fetch(endpoint + '/pulls?state=open', { headers: { Accept: 'application/vnd.github+json' } }).then((r) => r.json()),
    ])
    const cards = [
      ['Stars', repo.stargazers_count ?? '—'],
      ['Open PRs', Array.isArray(prs) ? prs.length : '—'],
      ['Default branch', repo.default_branch ?? '—'],
      ['License', repo.license?.spdx_id ?? '—'],
    ]
    grid.innerHTML = cards.map(([label, value]) => `<div><b>${String(value)}</b><span>${label}</span></div>`).join('')
  } catch {
    grid.innerHTML = '<p>Status unavailable — check back later.</p>'
  }
}

load()
