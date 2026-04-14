import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExecFile = vi.fn()
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...(args as [string, string[], object, Function]))
}))

import {
  remoteBranchExists,
  execInContainer,
  cloneInContainer,
  checkoutSlug,
  getCurrentBranch
} from '../../src/main/gitOps'

function makeContainer() {
  const start = vi.fn()
  const exec = vi.fn().mockResolvedValue({
    start: vi.fn().mockResolvedValue({
      on: (event: string, cb: (...a: unknown[]) => void) => {
        if (event === 'end') setImmediate(() => cb())
        return { on: () => ({}) }
      }
    }),
    inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
  })
  return { id: 'test-container', exec, start }
}

describe('remoteBranchExists', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
  })

  it('returns true when ls-remote prints at least one ref line', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, 'deadbeef refs/heads/my-slug\n', '')
    )
    const ok = await remoteBranchExists('git@github.com:org/repo.git', 'my-slug', 'PAT')
    expect(ok).toBe(true)
  })

  it('returns false when ls-remote prints nothing', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, '', '')
    )
    expect(await remoteBranchExists('git@github.com:org/repo.git', 'missing', 'PAT')).toBe(false)
  })

  it('uses an HTTPS URL with the PAT and matches the specific slug', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, '', '')
    )
    await remoteBranchExists('git@github.com:org/repo.git', 'feat/x', 'PAT')
    const call = mockExecFile.mock.calls[0]
    expect(call[0]).toBe('git')
    expect(call[1]).toEqual([
      'ls-remote',
      '--heads',
      'https://PAT@github.com/org/repo.git',
      'feat/x'
    ])
  })

  it('scrubs the PAT from errors on ls-remote failure', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: Function) => {
        const err: Error & { stderr?: string } = new Error(
          "fatal: unable to access 'https://PAT@github.com/org/repo.git/': 403"
        )
        err.stderr = 'remote: https://PAT@github.com/org/repo.git/'
        cb(err)
      }
    )
    await expect(remoteBranchExists('git@github.com:org/repo.git', 'slug', 'PAT')).rejects.toThrow(
      /\*\*\*/
    )
    await expect(
      remoteBranchExists('git@github.com:org/repo.git', 'slug', 'PAT')
    ).rejects.not.toThrow(/PAT/)
  })
})

describe('execInContainer', () => {
  it('runs a command, collects stdout, and returns exit code', async () => {
    const container = {
      id: 'c1',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (data?: Buffer) => void) {
            if (event === 'data') setImmediate(() => cb(Buffer.from('hello\n')))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
      })
    }
    // @ts-expect-error mock shape
    const res = await execInContainer(container, ['echo', 'hi'])
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('hello')
  })
})

describe('cloneInContainer', () => {
  it('clones with a PAT URL then rewrites origin back to the SSH URL', async () => {
    const container = makeContainer()
    // @ts-expect-error mock
    await cloneInContainer(container, 'git@github.com:org/my-repo.git', 'PAT', '/workspace/my-repo')
    const execArgs = container.exec.mock.calls.map((c) => c[0].Cmd)
    expect(execArgs[0]).toEqual([
      'git',
      'clone',
      'https://PAT@github.com/org/my-repo.git',
      '/workspace/my-repo'
    ])
    expect(execArgs[1]).toEqual([
      'git',
      '-C',
      '/workspace/my-repo',
      'remote',
      'set-url',
      'origin',
      'git@github.com:org/my-repo.git'
    ])
  })

  it('scrubs the PAT from the error message when clone fails', async () => {
    const stdoutPayload = "fatal: unable to access 'https://PAT@github.com/org/my-repo.git/': 403"
    const container = {
      id: 'c1',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (data?: Buffer) => void) {
            if (event === 'data') setImmediate(() => cb(Buffer.from(stdoutPayload)))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 128 })
      })
    }
    await expect(
      // @ts-expect-error mock
      cloneInContainer(container, 'git@github.com:org/my-repo.git', 'PAT', '/workspace/my-repo')
    ).rejects.toThrow(/\*\*\*/)
    await expect(
      // @ts-expect-error mock
      cloneInContainer(container, 'git@github.com:org/my-repo.git', 'PAT', '/workspace/my-repo')
    ).rejects.not.toThrow(/PAT/)
  })
})

describe('checkoutSlug', () => {
  it('uses plain checkout when the remote has the branch', async () => {
    const container = makeContainer()
    // @ts-expect-error mock
    await checkoutSlug(container, '/workspace/r', 'slug', true)
    expect(container.exec.mock.calls[0][0].Cmd).toEqual([
      'git',
      '-C',
      '/workspace/r',
      'checkout',
      'slug'
    ])
  })

  it('uses checkout -b when the remote does not have the branch', async () => {
    const container = makeContainer()
    // @ts-expect-error mock
    await checkoutSlug(container, '/workspace/r', 'slug', false)
    expect(container.exec.mock.calls[0][0].Cmd).toEqual([
      'git',
      '-C',
      '/workspace/r',
      'checkout',
      '-b',
      'slug'
    ])
  })
})

describe('getCurrentBranch', () => {
  it('issues rev-parse --abbrev-ref HEAD inside the container', async () => {
    const container = makeContainer()
    // @ts-expect-error mock
    await getCurrentBranch(container, '/workspace/r')
    expect(container.exec.mock.calls[0][0].Cmd).toEqual([
      'git',
      '-C',
      '/workspace/r',
      'rev-parse',
      '--abbrev-ref',
      'HEAD'
    ])
  })
})
