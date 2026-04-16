import { getDb } from './db'

export interface ProjectDependency {
  id: number
  project_id: number
  image: string
  tag: string
  env_vars: Record<string, string> | null
  created_at: string
}

export interface WindowDepContainer {
  id: number
  window_id: number
  dependency_id: number
  container_id: string
  image: string
  tag: string
}

export type WindowDependencyContainer = WindowDepContainer

interface RawDep {
  id: number
  project_id: number
  image: string
  tag: string
  env_vars: string | null
  created_at: string
}

function parseDep(raw: RawDep): ProjectDependency {
  return { ...raw, env_vars: raw.env_vars ? (JSON.parse(raw.env_vars) as Record<string, string>) : null }
}

function parseImageRef(image: string): {
  isHub: boolean
  registry: string
  namespace: string
  repoPath: string
} {
  const parts = image.split('/')
  if (parts.length === 1) {
    return { isHub: true, registry: 'hub.docker.com', namespace: 'library', repoPath: parts[0] }
  }
  if (parts.length === 2 && !parts[0].includes('.') && !parts[0].includes(':')) {
    return { isHub: true, registry: 'hub.docker.com', namespace: parts[0], repoPath: parts[1] }
  }
  const registry = parts[0]
  const repoPath = parts.slice(1).join('/')
  return { isHub: false, registry, namespace: '', repoPath }
}

export async function validateImage(image: string, tag: string): Promise<void> {
  const ref = parseImageRef(image)

  if (ref.isHub) {
    const url = `https://hub.docker.com/v2/repositories/${ref.namespace}/${ref.repoPath}/tags/${tag}/`
    const res = await fetch(url)
    if (res.status === 404) throw new Error(`Image ${image}:${tag} not found on Docker Hub`)
    if (!res.ok) throw new Error(`Registry error: ${res.status}`)
    return
  }

  // OCI registry: try manifest directly, handle 401 with token exchange
  const manifestUrl = `https://${ref.registry}/v2/${ref.repoPath}/manifests/${tag}`
  let res = await fetch(manifestUrl, {
    headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' }
  })

  if (res.status === 401) {
    const wwwAuth = res.headers.get('Www-Authenticate') ?? ''
    const realmMatch = wwwAuth.match(/realm="([^"]+)"/)
    const serviceMatch = wwwAuth.match(/service="([^"]+)"/)
    const scopeMatch = wwwAuth.match(/scope="([^"]+)"/)
    if (realmMatch) {
      const tokenUrl = new URL(realmMatch[1])
      if (serviceMatch) tokenUrl.searchParams.set('service', serviceMatch[1])
      if (scopeMatch) tokenUrl.searchParams.set('scope', scopeMatch[1])
      const tokenRes = await fetch(tokenUrl.toString())
      if (tokenRes.ok) {
        const body = (await tokenRes.json()) as { token?: string; access_token?: string }
        const token = body.token ?? body.access_token
        if (token) {
          res = await fetch(manifestUrl, {
            headers: {
              Accept: 'application/vnd.docker.distribution.manifest.v2+json',
              Authorization: `Bearer ${token}`
            }
          })
        }
      }
    }
  }

  if (res.status === 404) throw new Error(`Image ${image}:${tag} not found`)
  if (res.status === 401 || res.status === 403) throw new Error(`Image ${image}:${tag} is private or requires authentication`)
  if (!res.ok) throw new Error(`Registry error: ${res.status}`)
}

export function listDependencies(projectId: number): ProjectDependency[] {
  return (
    getDb()
      .prepare('SELECT id, project_id, image, tag, env_vars, created_at FROM project_dependencies WHERE project_id = ? ORDER BY created_at')
      .all(projectId) as RawDep[]
  ).map(parseDep)
}

export async function createDependency(
  projectId: number,
  image: string,
  tag: string,
  envVars: Record<string, string> = {}
): Promise<ProjectDependency> {
  await validateImage(image, tag)
  const envJson = Object.keys(envVars).length > 0 ? JSON.stringify(envVars) : null
  const result = getDb()
    .prepare('INSERT INTO project_dependencies (project_id, image, tag, env_vars) VALUES (?, ?, ?, ?)')
    .run(projectId, image, tag, envJson)
  return parseDep(
    getDb()
      .prepare('SELECT id, project_id, image, tag, env_vars, created_at FROM project_dependencies WHERE id = ?')
      .get(result.lastInsertRowid as number) as RawDep
  )
}

export function deleteDependency(id: number): void {
  getDb().prepare('DELETE FROM project_dependencies WHERE id = ?').run(id)
}

export function updateDependency(
  id: number,
  envVars: Record<string, string> | null
): ProjectDependency {
  const envJson = envVars && Object.keys(envVars).length > 0 ? JSON.stringify(envVars) : null
  const result = getDb()
    .prepare('UPDATE project_dependencies SET env_vars = ? WHERE id = ?')
    .run(envJson, id)
  if (result.changes === 0) throw new Error(`dependency ${id} not found`)
  return parseDep(
    getDb()
      .prepare('SELECT id, project_id, image, tag, env_vars, created_at FROM project_dependencies WHERE id = ?')
      .get(id) as RawDep
  )
}

export function listWindowDeps(windowId: number): WindowDepContainer[] {
  return getDb()
    .prepare(
      `SELECT wdc.id, wdc.window_id, wdc.dependency_id, wdc.container_id,
              pd.image, pd.tag
       FROM window_dependency_containers wdc
       JOIN project_dependencies pd ON pd.id = wdc.dependency_id
       WHERE wdc.window_id = ?`
    )
    .all(windowId) as WindowDepContainer[]
}

// Keep the old name as an alias for backward compatibility
export const listWindowDepContainers = listWindowDeps
