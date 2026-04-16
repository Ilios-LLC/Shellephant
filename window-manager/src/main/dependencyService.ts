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
  if (parts.length === 2 && !parts[0].includes('.')) {
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

  // OCI registry: try anonymous token exchange, then check manifest
  const authRes = await fetch(`https://${ref.registry}/v2/`)
  let token: string | null = null
  if (authRes.status === 401) {
    const wwwAuth =
      (authRes.headers as unknown as { get(k: string): string | null }).get('www-authenticate') ??
      ''
    const realmMatch = wwwAuth.match(/realm="([^"]+)"/)
    const serviceMatch = wwwAuth.match(/service="([^"]+)"/)
    if (realmMatch) {
      const tokenUrl = `${realmMatch[1]}?service=${serviceMatch?.[1] ?? ''}&scope=repository:${ref.repoPath}:pull`
      const tokenRes = await fetch(tokenUrl)
      if (tokenRes.ok) {
        const body = (await tokenRes.json()) as { token?: string; access_token?: string }
        token = body.token ?? body.access_token ?? null
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.docker.distribution.manifest.v2+json'
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const mRes = await fetch(`https://${ref.registry}/v2/${ref.repoPath}/manifests/${tag}`, {
    headers
  })
  if (mRes.status === 404) throw new Error(`Image ${image}:${tag} not found`)
  if (mRes.status === 401 || mRes.status === 403) throw new Error('Image must be public')
  if (!mRes.ok) throw new Error(`Registry error: ${mRes.status}`)
}

export function listDependencies(projectId: number): ProjectDependency[] {
  const rows = getDb()
    .prepare('SELECT * FROM project_dependencies WHERE project_id = ? ORDER BY created_at')
    .all(projectId) as Array<Omit<ProjectDependency, 'env_vars'> & { env_vars: string | null }>
  return rows.map((r) => ({
    ...r,
    env_vars: r.env_vars ? (JSON.parse(r.env_vars) as Record<string, string>) : null
  }))
}

export async function createDependency(
  projectId: number,
  data: { image: string; tag: string; envVars?: Record<string, string> }
): Promise<ProjectDependency> {
  await validateImage(data.image, data.tag)
  const envJson =
    data.envVars && Object.keys(data.envVars).length > 0 ? JSON.stringify(data.envVars) : null
  const result = getDb()
    .prepare(
      'INSERT INTO project_dependencies (project_id, image, tag, env_vars) VALUES (?, ?, ?, ?)'
    )
    .run(projectId, data.image, data.tag, envJson)
  return {
    id: result.lastInsertRowid as number,
    project_id: projectId,
    image: data.image,
    tag: data.tag,
    env_vars: data.envVars ?? null,
    created_at: new Date().toISOString()
  }
}

export function deleteDependency(id: number): void {
  getDb().prepare('DELETE FROM project_dependencies WHERE id = ?').run(id)
}

export function listWindowDepContainers(windowId: number): WindowDepContainer[] {
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
