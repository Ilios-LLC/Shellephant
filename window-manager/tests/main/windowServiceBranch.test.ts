import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/main/docker', () => ({ getDocker: vi.fn() }))
vi.mock('../../src/main/settingsService', () => ({
  getGitHubPat: vi.fn(() => 'pat'),
  getClaudeToken: vi.fn(() => 'token')
}))

const mockCheckoutSlug = vi.fn(async () => {})
const mockRemoteBranchExists = vi.fn(async () => false)
const mockCloneInContainer = vi.fn(async () => {})
const mockExecInContainer = vi.fn(async () => ({ ok: true, stdout: '' }))
const mockApplyGitIdentityInContainer = vi.fn(async () => {})

vi.mock('../../src/main/gitOps', () => ({
  remoteBranchExists: (...args: unknown[]) => mockRemoteBranchExists(...args),
  execInContainer: (...args: unknown[]) => mockExecInContainer(...args),
  cloneInContainer: (...args: unknown[]) => mockCloneInContainer(...args),
  checkoutSlug: (...args: unknown[]) => mockCheckoutSlug(...args),
  applyGitIdentityInContainer: (...args: unknown[]) => mockApplyGitIdentityInContainer(...args)
}))
vi.mock('../../src/main/terminalService', () => ({ closeTerminalSessionFor: vi.fn() }))
vi.mock('../../src/main/dependencyService', () => ({
  listDependencies: vi.fn(() => []),
  listWindowDepContainers: vi.fn(() => [])
}))
vi.mock('../../src/main/gitUrl', () => ({
  extractRepoName: vi.fn(() => 'repo'),
  sshUrlToHttps: vi.fn((url: string) => url),
  isValidSshUrl: vi.fn(() => true),
  buildPrUrl: vi.fn(() => '')
}))
vi.mock('../../src/main/githubIdentity', () => ({
  getIdentity: vi.fn(async () => ({ name: 'Test User', email: 'test@example.com' }))
}))

import { initDb, closeDb, getDb } from '../../src/main/db'
import { createWindow, __resetStatusMapForTests } from '../../src/main/windowService'
import { getDocker } from '../../src/main/docker'

function makeContainer(id = 'ctr-id') {
  return {
    id,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    inspect: vi.fn(async () => ({ NetworkSettings: { Ports: {} } })),
    exec: vi.fn(async () => ({
      start: vi.fn(async () => ({
        on: (event: string, cb: (...a: unknown[]) => void) => {
          if (event === 'end') setImmediate(() => cb())
          return { on: () => ({}) }
        }
      })),
      inspect: vi.fn(async () => ({ ExitCode: 0 }))
    }))
  }
}

function seedProject(gitUrl: string, name = 'test'): number {
  return (getDb()
    .prepare('INSERT INTO projects (name, git_url) VALUES (?, ?)')
    .run(name, gitUrl).lastInsertRowid) as number
}

describe('createWindow branchOverrides', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
    vi.clearAllMocks()
    const ctr = makeContainer()
    ;(getDocker as ReturnType<typeof vi.fn>).mockReturnValue({
      createContainer: vi.fn(async () => ctr),
      getContainer: vi.fn(() => ctr)
    })
  })

  afterEach(() => { closeDb() })

  it('calls checkoutSlug with slug and remoteHasSlug when no override given', async () => {
    const id = seedProject('git@github.com:org/repo.git')
    mockRemoteBranchExists.mockResolvedValue(true)
    await createWindow('my-win', id, false, {})
    expect(mockCheckoutSlug).toHaveBeenCalledWith(
      expect.anything(), '/workspace/repo', 'my-win', true
    )
  })

  it('calls checkoutSlug with override branch and remoteHasSlug=true when override given', async () => {
    const id = seedProject('git@github.com:org/repo.git')
    await createWindow('my-win', id, false, { [id]: 'feature/existing' })
    expect(mockCheckoutSlug).toHaveBeenCalledWith(
      expect.anything(), '/workspace/repo', 'feature/existing', true
    )
  })

  it('does not call remoteBranchExists for projects with overrides', async () => {
    const id = seedProject('git@github.com:org/repo.git')
    await createWindow('my-win', id, false, { [id]: 'feature/existing' })
    expect(mockRemoteBranchExists).not.toHaveBeenCalled()
  })

  it('handles mixed: override for one project, slug behavior for another', async () => {
    const id1 = seedProject('git@github.com:org/repo1.git', 'p1')
    const id2 = seedProject('git@github.com:org/repo2.git', 'p2')
    mockRemoteBranchExists.mockResolvedValue(false)
    await createWindow('my-win', [id1, id2], false, { [id1]: 'feature/pick' })
    const calls = mockCheckoutSlug.mock.calls
    const p1Call = calls.find(c => c[2] === 'feature/pick')
    const p2Call = calls.find(c => c[2] === 'my-win')
    expect(p1Call).toBeDefined()
    expect(p1Call![3]).toBe(true)
    expect(p2Call).toBeDefined()
    expect(p2Call![3]).toBe(false)
  })
})
