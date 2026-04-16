import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

vi.stubGlobal('fetch', vi.fn())

import {
  validateImage,
  listDependencies,
  createDependency,
  deleteDependency
} from '../../src/main/dependencyService'

function seedProject(): number {
  return (
    getDb()
      .prepare("INSERT INTO projects (name, git_url) VALUES ('p', 'https://github.com/x/y')")
      .run().lastInsertRowid as number
  )
}

describe('validateImage', () => {
  it('passes for a valid Docker Hub library image', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response)
    await expect(validateImage('postgres', 'latest')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith(
      'https://hub.docker.com/v2/repositories/library/postgres/tags/latest/'
    )
  })

  it('passes for a valid Docker Hub user image', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response)
    await expect(validateImage('myuser/myimage', '1.0')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith(
      'https://hub.docker.com/v2/repositories/myuser/myimage/tags/1.0/'
    )
  })

  it('throws for a 404 Hub image', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response)
    await expect(validateImage('postgres', 'nonexistent')).rejects.toThrow('not found')
  })

  it('throws "Image must be public" for OCI 401', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        status: 401,
        headers: { get: () => 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' }
      } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'tok' }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
    await expect(validateImage('ghcr.io/foo/bar', 'latest')).rejects.toThrow('must be public')
  })
})

describe('listDependencies / createDependency / deleteDependency', () => {
  beforeEach(() => initDb(':memory:'))
  afterEach(() => closeDb())

  it('returns empty list for project with no deps', () => {
    const pid = seedProject()
    expect(listDependencies(pid)).toEqual([])
  })

  it('creates and lists a dependency', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)
    const pid = seedProject()
    const dep = await createDependency(pid, { image: 'redis', tag: 'alpine' })
    expect(dep).toMatchObject({ project_id: pid, image: 'redis', tag: 'alpine', env_vars: null })
    expect(listDependencies(pid)).toHaveLength(1)
  })

  it('creates dependency with env vars', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)
    const pid = seedProject()
    const dep = await createDependency(pid, {
      image: 'postgres',
      tag: 'latest',
      envVars: { POSTGRES_PASSWORD: 'secret' }
    })
    expect(dep.env_vars).toEqual({ POSTGRES_PASSWORD: 'secret' })
  })

  it('throws validation error and does not insert if image invalid', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response)
    const pid = seedProject()
    await expect(createDependency(pid, { image: 'badimage', tag: 'nope' })).rejects.toThrow()
    expect(listDependencies(pid)).toHaveLength(0)
  })

  it('deletes a dependency', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response)
    const pid = seedProject()
    const dep = await createDependency(pid, { image: 'redis', tag: 'latest' })
    deleteDependency(dep.id)
    expect(listDependencies(pid)).toHaveLength(0)
  })
})
