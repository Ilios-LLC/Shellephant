import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock modules before imports
vi.mock('../../src/main/docker', () => ({
  getDocker: vi.fn()
}))
vi.mock('../../src/main/settingsService', () => ({
  getGitHubPat: vi.fn(() => 'pat'),
  getClaudeToken: vi.fn(() => 'token')
}))
vi.mock('../../src/main/gitOps', () => ({
  remoteBranchExists: vi.fn(async () => false),
  execInContainer: vi.fn(async () => ({ ok: true, stdout: '' })),
  cloneInContainer: vi.fn(async () => {}),
  checkoutSlug: vi.fn(async () => {})
}))
vi.mock('../../src/main/terminalService', () => ({
  closeTerminalSessionFor: vi.fn()
}))
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

import { initDb, closeDb, getDb } from '../../src/main/db'
import { createWindow, deleteWindow, __resetStatusMapForTests } from '../../src/main/windowService'
import { getDocker } from '../../src/main/docker'
import { listDependencies, listWindowDepContainers } from '../../src/main/dependencyService'

function makeContainer(id = 'ctr-id') {
  return {
    id,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    inspect: vi.fn(async () => ({ NetworkSettings: { Ports: {} } })),
    exec: vi.fn()
  }
}

function makeNetwork(id = 'net-id') {
  return {
    id,
    remove: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {})
  }
}

function seedProject(db: ReturnType<typeof getDb>): number {
  return db
    .prepare("INSERT INTO projects (name, git_url) VALUES ('proj', 'https://github.com/x/repo')")
    .run().lastInsertRowid as number
}

describe('createWindow without deps', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
    const ctr = makeContainer()
    vi.mocked(getDocker).mockReturnValue({
      createContainer: vi.fn(async () => ctr),
      pull: vi.fn(),
      createNetwork: vi.fn()
    } as never)
  })
  afterEach(() => closeDb())

  it('inserts a window row and returns WindowRecord', async () => {
    const pid = seedProject(getDb())
    const win = await createWindow('my-win', pid, false)
    expect(win.name).toBe('my-win')
    expect(win.status).toBe('running')
    const row = getDb().prepare('SELECT * FROM windows WHERE id = ?').get(win.id) as { network_id: string | null }
    expect(row.network_id).toBeNull()
  })
})

describe('createWindow with deps', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
  })
  afterEach(() => closeDb())

  it('creates bridge network and dep containers before main container', async () => {
    const pid = seedProject(getDb())
    const depId = getDb()
      .prepare("INSERT INTO project_dependencies (project_id, image, tag) VALUES (?, 'redis', 'alpine')")
      .run(pid).lastInsertRowid as number
    const depCtr = makeContainer('dep-ctr')
    const mainCtr = makeContainer('main-ctr')
    const net = makeNetwork('net-123')
    const docker = {
      createContainer: vi.fn()
        .mockResolvedValueOnce(depCtr)
        .mockResolvedValueOnce(mainCtr),
      pull: vi.fn((_img: string, cb: (err: null, stream: object) => void) => {
        cb(null, { pipe: vi.fn() })
      }),
      modem: { followProgress: vi.fn((_s: object, cb: () => void) => cb()) },
      createNetwork: vi.fn(async () => net),
      getNetwork: vi.fn(() => net)
    }
    vi.mocked(getDocker).mockReturnValue(docker as never)
    vi.mocked(listDependencies).mockReturnValue([
      { id: depId, project_id: pid, image: 'redis', tag: 'alpine', env_vars: null, created_at: '' }
    ])

    const win = await createWindow('win', pid, true)

    expect(docker.createNetwork).toHaveBeenCalledWith(
      expect.objectContaining({ Driver: 'bridge' })
    )
    expect(docker.createContainer).toHaveBeenCalledTimes(2)
    expect(depCtr.start).toHaveBeenCalled()
    expect(net.connect).toHaveBeenCalledWith(expect.objectContaining({ Container: 'main-ctr' }))

    const row = getDb().prepare('SELECT network_id FROM windows WHERE id = ?').get(win.id) as { network_id: string }
    expect(row.network_id).toBe('net-123')

    const depRows = getDb()
      .prepare('SELECT * FROM window_dependency_containers WHERE window_id = ?')
      .all(win.id)
    expect(depRows).toHaveLength(1)
  })

  it('cleans up dep containers and network when main container creation fails', async () => {
    const pid = seedProject(getDb())
    const depCtr = makeContainer('dep-ctr')
    const net = makeNetwork('net-xyz')
    const docker = {
      createContainer: vi.fn()
        .mockResolvedValueOnce(depCtr)
        .mockRejectedValueOnce(new Error('docker failure')),
      pull: vi.fn((_img: string, cb: (err: null, stream: object) => void) => {
        cb(null, {})
      }),
      modem: { followProgress: vi.fn((_s: object, cb: () => void) => cb()) },
      createNetwork: vi.fn(async () => net),
      getNetwork: vi.fn(() => net)
    }
    vi.mocked(getDocker).mockReturnValue(docker as never)
    vi.mocked(listDependencies).mockReturnValue([
      { id: 1, project_id: pid, image: 'redis', tag: 'latest', env_vars: null, created_at: '' }
    ])

    await expect(createWindow('win', pid, true)).rejects.toThrow('docker failure')
    expect(depCtr.stop).toHaveBeenCalled()
    expect(depCtr.remove).toHaveBeenCalled()
    expect(net.remove).toHaveBeenCalled()
  })
})

describe('createWindow with external network', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
  })
  afterEach(() => closeDb())

  it('connects main container to named network without creating one', async () => {
    const pid = seedProject(getDb())
    const mainCtr = makeContainer('main-ctr')
    const net = makeNetwork('ext-net')
    const docker = {
      createContainer: vi.fn(async () => mainCtr),
      pull: vi.fn(),
      createNetwork: vi.fn(),
      getNetwork: vi.fn(() => net)
    }
    vi.mocked(getDocker).mockReturnValue(docker as never)
    vi.mocked(listDependencies).mockReturnValue([])

    const win = await createWindow('win', pid, false, {}, () => {}, 'ext-net')

    expect(docker.createNetwork).not.toHaveBeenCalled()
    expect(docker.getNetwork).toHaveBeenCalledWith('ext-net')
    expect(net.connect).toHaveBeenCalledWith(expect.objectContaining({ Container: 'main-ctr' }))
    const row = getDb().prepare('SELECT network_id FROM windows WHERE id = ?').get(win.id) as { network_id: string }
    expect(row.network_id).toBe('ext-net')
  })
})

describe('deleteWindow with deps', () => {
  beforeEach(() => {
    initDb(':memory:')
    __resetStatusMapForTests()
  })
  afterEach(() => closeDb())

  it('stops and removes dep containers then removes network', async () => {
    const pid = seedProject(getDb())
    const db = getDb()
    const winRow = db
      .prepare("INSERT INTO windows (name, project_id, container_id, network_id) VALUES ('w', ?, 'main-ctr', 'net-abc')")
      .run(pid)
    const winId = winRow.lastInsertRowid as number
    db.prepare('INSERT INTO project_dependencies (project_id, image, tag) VALUES (?, ?, ?)').run(pid, 'redis', 'latest')
    const depId = db.prepare('SELECT id FROM project_dependencies').get() as { id: number }
    db.prepare('INSERT INTO window_dependency_containers (window_id, dependency_id, container_id) VALUES (?, ?, ?)').run(winId, depId.id, 'dep-ctr')

    const depCtr = { stop: vi.fn(async () => {}), remove: vi.fn(async () => {}) }
    const mainCtr = { stop: vi.fn(async () => {}) }
    const net = { remove: vi.fn(async () => {}), disconnect: vi.fn(async () => {}) }
    vi.mocked(getDocker).mockReturnValue({
      getContainer: vi.fn((id: string) => (id === 'dep-ctr' ? depCtr : mainCtr)),
      getNetwork: vi.fn(() => net)
    } as never)
    vi.mocked(listWindowDepContainers).mockReturnValue([
      { id: 1, window_id: winId, dependency_id: depId.id, container_id: 'dep-ctr', image: 'redis', tag: 'latest' }
    ])

    await deleteWindow(winId)

    expect(depCtr.stop).toHaveBeenCalled()
    expect(depCtr.remove).toHaveBeenCalled()
    expect(net.disconnect).toHaveBeenCalledWith({ Container: 'main-ctr', Force: true })
    expect(net.remove).toHaveBeenCalled()
    expect(mainCtr.stop).toHaveBeenCalled()
  })

  it('disconnects from external network but does not remove it', async () => {
    const pid = seedProject(getDb())
    const db = getDb()
    const winRow = db
      .prepare("INSERT INTO windows (name, project_id, container_id, network_id) VALUES ('w', ?, 'main-ctr', 'ext-net')")
      .run(pid)
    const winId = winRow.lastInsertRowid as number

    const mainCtr = { stop: vi.fn(async () => {}) }
    const net = { remove: vi.fn(async () => {}), disconnect: vi.fn(async () => {}) }
    vi.mocked(getDocker).mockReturnValue({
      getContainer: vi.fn(() => mainCtr),
      getNetwork: vi.fn(() => net)
    } as never)
    vi.mocked(listWindowDepContainers).mockReturnValue([])

    await deleteWindow(winId)

    expect(net.disconnect).toHaveBeenCalledWith({ Container: 'main-ctr', Force: true })
    expect(net.remove).not.toHaveBeenCalled()
    expect(mainCtr.stop).toHaveBeenCalled()
  })
})
