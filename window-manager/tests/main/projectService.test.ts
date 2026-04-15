import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDb, closeDb, getDb } from '../../src/main/db'

// Mock child_process for git ls-remote
const mockExecFile = vi.fn()
vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args)
}))

// Mock windowService to avoid dockerode dependency
vi.mock('../../src/main/windowService', () => ({
  listWindows: vi.fn().mockReturnValue([]),
  deleteWindow: vi.fn().mockResolvedValue(undefined)
}))

// Mock settingsService so we can control token presence without electron.
const mockGetGitHubPat = vi.fn<[], string | null>()
const mockGetClaudeToken = vi.fn<[], string | null>()
vi.mock('../../src/main/settingsService', () => ({
  getGitHubPat: () => mockGetGitHubPat(),
  getClaudeToken: () => mockGetClaudeToken()
}))

import {
  createProject,
  listProjects,
  deleteProject,
  updateProject
} from '../../src/main/projectService'

describe('projectService', () => {
  beforeEach(() => {
    initDb(':memory:')
    vi.clearAllMocks()
    mockGetGitHubPat.mockReturnValue('test-token')
    mockGetClaudeToken.mockReturnValue('claude-token')
    // Default: git ls-remote succeeds.
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      cb(null, '', '')
    })
  })

  afterEach(() => {
    closeDb()
  })

  describe('createProject', () => {
    it('creates a project with name and git URL', async () => {
      const result = await createProject('my-project', 'git@github.com:org/repo.git')
      expect(result.name).toBe('my-project')
      expect(result.git_url).toBe('git@github.com:org/repo.git')
      expect(result.id).toBeTypeOf('number')
    })

    it('derives name from URL when empty string provided', async () => {
      const result = await createProject('', 'git@github.com:org/my-repo.git')
      expect(result.name).toBe('my-repo')
    })

    it('rejects invalid SSH URLs', async () => {
      await expect(
        createProject('bad', 'https://github.com/org/repo.git')
      ).rejects.toThrow('Invalid SSH URL')
    })

    it('rejects duplicate git URLs', async () => {
      await createProject('first', 'git@github.com:org/repo.git')
      await expect(
        createProject('second', 'git@github.com:org/repo.git')
      ).rejects.toThrow('Project already exists')
    })

    it('runs git ls-remote with an https URL built from the stored PAT', async () => {
      await createProject('verified', 'git@github.com:org/repo.git')
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['ls-remote', '--exit-code', 'https://test-token@github.com/org/repo.git'],
        expect.any(Object),
        expect.any(Function)
      )
    })

    it('rejects when git ls-remote fails', async () => {
      mockExecFile.mockImplementationOnce((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(new Error('repository not found'), '', '')
      })

      await expect(
        createProject('bad-remote', 'git@github.com:org/nonexistent.git')
      ).rejects.toThrow('Repository not accessible')
    })

    it('throws when no PAT is configured', async () => {
      mockGetGitHubPat.mockReturnValue(null)
      await expect(
        createProject('no-pat', 'git@github.com:org/repo.git')
      ).rejects.toThrow(/PAT not configured/i)
      expect(mockExecFile).not.toHaveBeenCalled()
    })

    it('does not insert a project row when PAT is missing', async () => {
      mockGetGitHubPat.mockReturnValue(null)
      await expect(
        createProject('no-pat', 'git@github.com:org/repo.git')
      ).rejects.toThrow()
      expect(listProjects()).toHaveLength(0)
    })

    it('throws when no Claude token is configured', async () => {
      mockGetClaudeToken.mockReturnValue(null)
      await expect(
        createProject('no-claude', 'git@github.com:org/repo.git')
      ).rejects.toThrow(/Claude token not configured/i)
      expect(mockExecFile).not.toHaveBeenCalled()
      expect(listProjects()).toHaveLength(0)
    })

    it('stores ports when provided', async () => {
      const result = await createProject('with-ports', 'git@github.com:org/repo2.git', [3000, 8080])
      expect(result.ports).toBe(JSON.stringify([3000, 8080]))
    })

    it('stores no ports when omitted', async () => {
      const result = await createProject('no-ports', 'git@github.com:org/repo3.git')
      expect(result.ports).toBeUndefined()
    })

    it('rejects port value 0', async () => {
      await expect(
        createProject('bad-ports', 'git@github.com:org/repo4.git', [0])
      ).rejects.toThrow(/Invalid port/)
    })

    it('rejects port value 65536', async () => {
      await expect(
        createProject('bad-ports2', 'git@github.com:org/repo5.git', [65536])
      ).rejects.toThrow(/Invalid port/)
    })

    it('rejects non-integer port value', async () => {
      await expect(
        createProject('bad-ports3', 'git@github.com:org/repo6.git', [NaN])
      ).rejects.toThrow(/Invalid port/)
    })
  })

  describe('listProjects', () => {
    it('returns empty array when no projects exist', () => {
      expect(listProjects()).toEqual([])
    })

    it('returns active projects only', async () => {
      await createProject('active', 'git@github.com:org/active.git')
      await createProject('deleted', 'git@github.com:org/deleted.git')
      const projects = listProjects()
      const deletedProject = projects.find((p) => p.name === 'deleted')!
      await deleteProject(deletedProject.id)
      expect(listProjects()).toHaveLength(1)
      expect(listProjects()[0].name).toBe('active')
    })

    it('listProjects includes ports field', async () => {
      await createProject('list-ports', 'git@github.com:org/list-ports.git', [5432])
      const projects = listProjects()
      expect(projects[0].ports).toBe(JSON.stringify([5432]))
    })

    it('includes group_id in returned records', async () => {
      await createProject('grouped', 'git@github.com:org/grouped.git')
      const projects = listProjects()
      expect('group_id' in projects[0]).toBe(true)
    })
  })

  describe('deleteProject', () => {
    it('soft-deletes the project', async () => {
      const project = await createProject('to-delete', 'git@github.com:org/repo.git')
      await deleteProject(project.id)
      const row = getDb()
        .prepare('SELECT deleted_at FROM projects WHERE id = ?')
        .get(project.id) as { deleted_at: string | null }
      expect(row.deleted_at).not.toBeNull()
    })

    it('is idempotent — no error when deleting twice', async () => {
      const project = await createProject('twice', 'git@github.com:org/repo.git')
      await deleteProject(project.id)
      await expect(deleteProject(project.id)).resolves.toBeUndefined()
    })

    it('is idempotent — no error when project id does not exist', async () => {
      await expect(deleteProject(99999)).resolves.toBeUndefined()
    })
  })

  describe('updateProject', () => {
    it('sets group_id on a project', async () => {
      const project = await createProject('my-project', 'git@github.com:org/repo.git')
      const { createGroup } = await import('../../src/main/projectGroupService')
      const group = createGroup('frontend')

      const updated = updateProject(project.id, { groupId: group.id })
      expect(updated.group_id).toBe(group.id)
    })

    it('clears group_id when null is passed', async () => {
      const project = await createProject('my-project', 'git@github.com:org/repo2.git')
      const { createGroup } = await import('../../src/main/projectGroupService')
      const group = createGroup('frontend')
      updateProject(project.id, { groupId: group.id })

      const cleared = updateProject(project.id, { groupId: null })
      expect(cleared.group_id).toBeNull()
    })

    it('throws when the project does not exist', () => {
      expect(() => updateProject(99999, { groupId: null })).toThrow('Project 99999 not found')
    })
  })
})
