// tests/main/dependencyService.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  listDependencies,
  createDependency,
  deleteDependency,
  validateImage,
  listWindowDeps,
  updateDependency
} from '../../src/main/dependencyService'

function seedProject(): number {
  return getDb()
    .prepare("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:o/r.git')")
    .run().lastInsertRowid as number
}

function seedWindow(projectId: number): number {
  return getDb()
    .prepare("INSERT INTO windows (name, project_id, container_id) VALUES ('w', ?, 'cid')")
    .run(projectId).lastInsertRowid as number
}

describe('dependencyService', () => {
  beforeEach(() => { initDb(':memory:'); vi.clearAllMocks() })
  afterEach(() => { closeDb() })

  describe('listDependencies', () => {
    it('returns empty array when no deps', () => {
      expect(listDependencies(seedProject())).toEqual([])
    })

    it('returns deps for the given project', () => {
      const pid = seedProject()
      getDb().prepare("INSERT INTO project_dependencies (project_id, image, tag) VALUES (?, 'postgres', 'latest')").run(pid)
      const deps = listDependencies(pid)
      expect(deps).toHaveLength(1)
      expect(deps[0].image).toBe('postgres')
      expect(deps[0].env_vars).toBeNull()
    })

    it('parses env_vars JSON into object', () => {
      const pid = seedProject()
      getDb()
        .prepare("INSERT INTO project_dependencies (project_id, image, tag, env_vars) VALUES (?, 'postgres', 'latest', ?)")
        .run(pid, JSON.stringify({ POSTGRES_PASSWORD: 'secret' }))
      expect(listDependencies(pid)[0].env_vars).toEqual({ POSTGRES_PASSWORD: 'secret' })
    })
  })

  describe('createDependency', () => {
    it('inserts and returns dep after 200 response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const dep = await createDependency(pid, 'postgres', 'latest', {})
      expect(dep.image).toBe('postgres')
      expect(dep.project_id).toBe(pid)
    })

    it('throws and does not insert when registry returns 404', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
      const pid = seedProject()
      await expect(createDependency(pid, 'noexist', 'latest', {})).rejects.toThrow(/not found/i)
      expect(listDependencies(pid)).toHaveLength(0)
    })

    it('stores env_vars as JSON', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      await createDependency(pid, 'postgres', 'latest', { POSTGRES_PASSWORD: 'secret' })
      expect(listDependencies(pid)[0].env_vars).toEqual({ POSTGRES_PASSWORD: 'secret' })
    })
  })

  describe('deleteDependency', () => {
    it('removes the dep row', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const dep = await createDependency(pid, 'postgres', 'latest', {})
      deleteDependency(dep.id)
      expect(listDependencies(pid)).toHaveLength(0)
    })
  })

  describe('validateImage', () => {
    it('calls Docker Hub API for official image', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      await validateImage('postgres', 'latest')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hub.docker.com/v2/repositories/library/postgres/tags/latest/'
      )
    })

    it('calls Docker Hub API for user/image', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      await validateImage('myuser/myimage', 'v1')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hub.docker.com/v2/repositories/myuser/myimage/tags/v1/'
      )
    })

    it('throws not found for Hub 404', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
      await expect(validateImage('postgres', 'doesnotexist')).rejects.toThrow(/not found/i)
    })

    it('calls OCI manifest endpoint for ghcr.io', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      await validateImage('ghcr.io/foo/bar', 'latest')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://ghcr.io/v2/foo/bar/manifests/latest',
        expect.objectContaining({ headers: expect.objectContaining({ Accept: expect.any(String) }) })
      )
    })

    it('throws private for 401 without Www-Authenticate token exchange', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, headers: { get: () => null } })
      await expect(validateImage('ghcr.io/foo/private', 'latest')).rejects.toThrow(/private/i)
    })
  })

  describe('listWindowDeps', () => {
    it('returns dep containers for a window with image and tag', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const wid = seedWindow(pid)
      const dep = await createDependency(pid, 'postgres', 'latest', {})
      getDb()
        .prepare('INSERT INTO window_dependency_containers (window_id, dependency_id, container_id) VALUES (?, ?, ?)')
        .run(wid, dep.id, 'dep-cid')
      const rows = listWindowDeps(wid)
      expect(rows).toHaveLength(1)
      expect(rows[0].container_id).toBe('dep-cid')
      expect(rows[0].image).toBe('postgres')
      expect(rows[0].tag).toBe('latest')
    })

    it('returns empty array when no dep containers', () => {
      const pid = seedProject()
      const wid = seedWindow(pid)
      expect(listWindowDeps(wid)).toEqual([])
    })
  })

  describe('updateDependency', () => {
    it('updates env_vars and returns the updated dep', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const dep = await createDependency(pid, 'postgres', 'latest', {})
      const updated = updateDependency(dep.id, { DB_PASS: 'hunter2' })
      expect(updated.env_vars).toEqual({ DB_PASS: 'hunter2' })
      expect(updated.id).toBe(dep.id)
    })

    it('persists env_vars so listDependencies reflects the change', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const dep = await createDependency(pid, 'postgres', 'latest', {})
      updateDependency(dep.id, { KEY: 'val' })
      expect(listDependencies(pid)[0].env_vars).toEqual({ KEY: 'val' })
    })

    it('sets env_vars to null when passed null', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const dep = await createDependency(pid, 'postgres', 'latest', { EXISTING: 'x' })
      const updated = updateDependency(dep.id, null)
      expect(updated.env_vars).toBeNull()
    })

    it('stores null when env_vars is an empty object', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 })
      const pid = seedProject()
      const dep = await createDependency(pid, 'postgres', 'latest', { EXISTING: 'x' })
      const updated = updateDependency(dep.id, {})
      expect(updated.env_vars).toBeNull()
    })

    it('throws when id does not exist', () => {
      expect(() => updateDependency(9999, { K: 'v' })).toThrow(/not found/i)
    })
  })
})
