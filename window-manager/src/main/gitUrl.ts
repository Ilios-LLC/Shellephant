const SSH_URL_RE = /^git@([^:]+):(.+)$/

export function isValidSshUrl(url: string): boolean {
  if (!SSH_URL_RE.test(url)) return false
  const match = url.match(SSH_URL_RE)!
  const path = match[2]
  // Must have at least org/repo structure
  return path.includes('/')
}

export function extractRepoName(sshUrl: string): string {
  const match = sshUrl.match(SSH_URL_RE)
  if (!match) throw new Error(`Invalid SSH URL: ${sshUrl}`)
  const path = match[2]
  const lastSegment = path.split('/').pop()!
  return lastSegment.replace(/\.git$/, '')
}

export function sshUrlToHttps(sshUrl: string, pat: string): string {
  const match = sshUrl.match(SSH_URL_RE)
  if (!match) throw new Error(`Invalid SSH URL: ${sshUrl}`)
  const host = match[1]
  const path = match[2]
  return `https://${pat}@${host}/${path}`
}

export function buildPrUrl(sshUrl: string, branch: string): string {
  const match = sshUrl.match(SSH_URL_RE)
  if (!match) return ''
  const host = match[1]
  const repoPath = match[2].replace(/\.git$/, '')
  return `https://${host}/${repoPath}/compare/${encodeURIComponent(branch)}?expand=1`
}
