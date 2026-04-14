export interface GitHubIdentity {
  name: string
  email: string
}

let cached: GitHubIdentity | null = null

export function invalidateIdentity(): void {
  cached = null
}

export function __resetForTests(): void {
  cached = null
}

export async function getIdentity(pat: string): Promise<GitHubIdentity> {
  if (cached) return cached

  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })
  if (!res.ok) {
    throw new Error(`GitHub /user returned ${res.status} ${res.statusText ?? ''}`.trim())
  }
  const body = (await res.json()) as {
    id: number
    login: string
    name: string | null
    email: string | null
  }
  const email = body.email ?? `${body.id}+${body.login}@users.noreply.github.com`
  const name = body.name ?? body.login
  cached = { name, email }
  return cached
}
