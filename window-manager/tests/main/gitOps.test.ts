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
  getCurrentBranch,
  listRemoteBranches
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

describe('stageAndCommit', () => {
  it('runs git add --all then git commit with -c user.name/email and -m <subject>', async () => {
    const container = makeContainer()
    const { stageAndCommit } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await stageAndCommit(container, '/workspace/r', {
      subject: 'Fix bug',
      body: '',
      name: 'Octo',
      email: 'o@x'
    })

    const cmds = container.exec.mock.calls.map((c) => c[0].Cmd)
    expect(cmds[0]).toEqual(['git', '-C', '/workspace/r', 'add', '--all'])
    expect(cmds[1]).toEqual([
      'git',
      '-C',
      '/workspace/r',
      '-c',
      'user.name=Octo',
      '-c',
      'user.email=o@x',
      'commit',
      '-m',
      'Fix bug'
    ])
  })

  it('includes a second -m flag when body is non-empty', async () => {
    const container = makeContainer()
    const { stageAndCommit } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await stageAndCommit(container, '/workspace/r', {
      subject: 'subj',
      body: 'more details',
      name: 'n',
      email: 'e'
    })
    const commitCmd = container.exec.mock.calls[1][0].Cmd
    expect(commitCmd).toContain('-m')
    expect(commitCmd[commitCmd.length - 2]).toBe('-m')
    expect(commitCmd[commitCmd.length - 1]).toBe('more details')
  })

  it('omits the body flag when body is whitespace-only', async () => {
    const container = makeContainer()
    const { stageAndCommit } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await stageAndCommit(container, '/workspace/r', {
      subject: 's',
      body: '   ',
      name: 'n',
      email: 'e'
    })
    const commitCmd = container.exec.mock.calls[1][0].Cmd
    // Count -m occurrences: should be exactly 1 (for subject).
    const dashMCount = commitCmd.filter((a: string) => a === '-m').length
    expect(dashMCount).toBe(1)
  })

  it('short-circuits with the add result when git add fails', async () => {
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValueOnce({
        start: async () => ({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data') setImmediate(() => cb(Buffer.from('add failed')))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: async () => ({ ExitCode: 128 })
      })
    }
    const { stageAndCommit } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const res = await stageAndCommit(container, '/workspace/r', {
      subject: 's',
      body: '',
      name: 'n',
      email: 'e'
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(128)
    expect(container.exec).toHaveBeenCalledTimes(1) // commit was NOT attempted
  })

  it('returns the non-zero commit result when "nothing to commit"', async () => {
    const container = {
      id: 'c',
      exec: vi
        .fn()
        .mockResolvedValueOnce({
          start: async () => ({
            on(event: string, cb: (d?: Buffer) => void) {
              if (event === 'end') setImmediate(() => cb())
              return this
            }
          }),
          inspect: async () => ({ ExitCode: 0 })
        })
        .mockResolvedValueOnce({
          start: async () => ({
            on(event: string, cb: (d?: Buffer) => void) {
              if (event === 'data')
                setImmediate(() => cb(Buffer.from('nothing to commit, working tree clean')))
              if (event === 'end') setImmediate(() => cb())
              return this
            }
          }),
          inspect: async () => ({ ExitCode: 1 })
        })
    }
    const { stageAndCommit } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const res = await stageAndCommit(container, '/workspace/r', {
      subject: 's',
      body: '',
      name: 'n',
      email: 'e'
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(1)
    expect(res.stdout).toMatch(/nothing to commit/i)
  })
})

describe('push', () => {
  it('pushes to an explicit https URL with -u, branch, scrubbing PAT from stdout', async () => {
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: async () => ({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data')
              setImmediate(() => cb(Buffer.from('pushing to https://PAT@github.com/org/r')))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: async () => ({ ExitCode: 0 })
      })
    }
    const { push } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const res = await push(
      container,
      '/workspace/r',
      'my-feature',
      'git@github.com:org/r.git',
      'PAT'
    )

    const cmd = container.exec.mock.calls[0][0].Cmd
    expect(cmd).toEqual([
      'git',
      '-C',
      '/workspace/r',
      'push',
      '-u',
      'https://PAT@github.com/org/r.git',
      'my-feature'
    ])
    expect(res.ok).toBe(true)
    expect(res.stdout).not.toContain('PAT')
    expect(res.stdout).toContain('***')
  })

  it('returns ok=false when the exec exits non-zero and scrubs PAT from output', async () => {
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: async () => ({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data')
              setImmediate(() =>
                cb(Buffer.from('! [rejected] non-fast-forward https://PAT@github.com/o/r.git'))
              )
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: async () => ({ ExitCode: 1 })
      })
    }
    const { push } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const res = await push(container, '/workspace/r', 'br', 'git@github.com:o/r.git', 'PAT')

    expect(res.ok).toBe(false)
    expect(res.code).toBe(1)
    expect(res.stdout).toMatch(/non-fast-forward/)
    expect(res.stdout).not.toContain('PAT')
  })
})

describe('listContainerDir', () => {
  it('parses ls -1p output into name/isDir pairs', async () => {
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data')
              setImmediate(() => cb(Buffer.from('src/\nREADME.md\npackage.json\n')))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
      })
    }
    const { listContainerDir } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const entries = await listContainerDir(container, '/workspace/r')
    expect(entries).toEqual([
      { name: 'src', isDir: true },
      { name: 'README.md', isDir: false },
      { name: 'package.json', isDir: false }
    ])
  })

  it('detects directories correctly when output uses CRLF (Docker TTY mode)', async () => {
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data')
              setImmediate(() => cb(Buffer.from('do-chat-interface/\r\nterraform/\r\ntasks.md\r\n')))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
      })
    }
    const { listContainerDir } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const entries = await listContainerDir(container, '/workspace/chorale')
    expect(entries).toEqual([
      { name: 'do-chat-interface', isDir: true },
      { name: 'terraform', isDir: true },
      { name: 'tasks.md', isDir: false }
    ])
  })

  it('filters out blocked directories', async () => {
    const blocked = 'node_modules/\n.venv/\nvenv/\n__pycache__/\n.git/\ndist/\nbuild/\n.next/\n.nuxt/\ntarget/\ncoverage/\nout/\n'
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data') setImmediate(() => cb(Buffer.from(`src/\n${blocked}index.ts\n`)))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
      })
    }
    const { listContainerDir } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const entries = await listContainerDir(container, '/workspace/r')
    const names = entries.map((e: { name: string }) => e.name)
    expect(names).toContain('src')
    expect(names).toContain('index.ts')
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.venv')
    expect(names).not.toContain('dist')
  })

  it('returns empty array when exec fails', async () => {
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 1 })
      })
    }
    const { listContainerDir } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const entries = await listContainerDir(container, '/workspace/r')
    expect(entries).toEqual([])
  })
})

describe('readContainerFile', () => {
  it('returns the file content as a string', async () => {
    const content = 'console.log("hello")\n'
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'data') setImmediate(() => cb(Buffer.from(content)))
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
      })
    }
    const { readContainerFile } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await readContainerFile(container, '/workspace/r/index.ts')
    expect(result).toBe(content)
  })

  it('issues cat with the exact file path', async () => {
    const container = makeContainer()
    const { readContainerFile } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await readContainerFile(container, '/workspace/r/src/app.ts')
    expect(container.exec.mock.calls[0][0].Cmd).toEqual(['cat', '/workspace/r/src/app.ts'])
  })

  it('throws when exec returns non-zero exit code', async () => {
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({
          on(event: string, cb: (d?: Buffer) => void) {
            if (event === 'end') setImmediate(() => cb())
            return this
          }
        }),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 1 })
      })
    }
    const { readContainerFile } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await expect(readContainerFile(container, '/workspace/r/missing.ts')).rejects.toThrow(/readContainerFile failed/)
  })
})

function makeGitStatusContainer(
  porcelainOutput: string,
  porcelainExitCode: number,
  shortstatOutput: string,
  shortstatExitCode: number
) {
  let callCount = 0
  const responses = [
    { stdout: porcelainOutput, exitCode: porcelainExitCode },
    { stdout: shortstatOutput, exitCode: shortstatExitCode }
  ]
  const exec = vi.fn().mockImplementation(async () => {
    const resp = responses[callCount++] ?? { stdout: '', exitCode: 0 }
    return {
      start: vi.fn().mockResolvedValue({
        on(event: string, cb: (data?: Buffer) => void) {
          if (event === 'data' && resp.stdout) setImmediate(() => cb(Buffer.from(resp.stdout)))
          if (event === 'end') setImmediate(() => cb())
          return this
        }
      }),
      inspect: vi.fn().mockResolvedValue({ ExitCode: resp.exitCode })
    }
  })
  return { id: 'c', exec }
}

describe('getGitStatus', () => {
  it('returns isDirty=false with 0/0 when working tree is clean', async () => {
    const container = makeGitStatusContainer('', 0, '', 0)
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await getGitStatus(container, '/workspace/r')
    expect(result).toEqual({ isDirty: false, added: 0, deleted: 0 })
  })

  it('returns isDirty=true with parsed counts when tracked files are modified', async () => {
    const container = makeGitStatusContainer(
      ' M src/foo.ts\n',
      0,
      ' 1 file changed, 12 insertions(+), 5 deletions(-)\n',
      0
    )
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await getGitStatus(container, '/workspace/r')
    expect(result).toEqual({ isDirty: true, added: 12, deleted: 5 })
  })

  it('returns isDirty=true with 0/0 when only untracked files exist', async () => {
    const container = makeGitStatusContainer('?? newfile.ts\n', 0, '', 0)
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await getGitStatus(container, '/workspace/r')
    expect(result).toEqual({ isDirty: true, added: 0, deleted: 0 })
  })

  it('returns isDirty=false with 0/0 when not a git repo (status fails)', async () => {
    const container = makeGitStatusContainer('', 128, '', 128)
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await getGitStatus(container, '/workspace/r')
    expect(result).toEqual({ isDirty: false, added: 0, deleted: 0 })
  })

  it('handles shortstat with only insertions (no deletions line)', async () => {
    const container = makeGitStatusContainer(
      'M  README.md\n',
      0,
      ' 1 file changed, 3 insertions(+)\n',
      0
    )
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    const result = await getGitStatus(container, '/workspace/r')
    expect(result).toEqual({ isDirty: true, added: 3, deleted: 0 })
  })

  it('passes git -C clonePath for both commands', async () => {
    const container = makeGitStatusContainer('', 0, '', 0)
    const { getGitStatus } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await getGitStatus(container, '/workspace/myrepo')
    const cmds = container.exec.mock.calls.map((c: [{ Cmd: string[] }]) => c[0].Cmd)
    expect(cmds[0]).toContain('-C')
    expect(cmds[0]).toContain('/workspace/myrepo')
    expect(cmds[0]).toContain('--porcelain')
    expect(cmds[1]).toContain('--shortstat')
    expect(cmds[1]).toContain('HEAD')
  })
})

describe('writeFileInContainer', () => {
  it('execs tee with the target path and AttachStdin: true', async () => {
    const mockStream = {
      on: vi.fn().mockReturnThis(),
      write: vi.fn(),
      end: vi.fn()
    }
    // Simulate 'finish' event firing after end()
    mockStream.on.mockImplementation(function (
      this: typeof mockStream,
      event: string,
      cb: () => void
    ) {
      if (event === 'finish') setImmediate(() => cb())
      return this
    })

    const execInstance = {
      start: vi.fn().mockResolvedValue(mockStream),
      inspect: vi.fn().mockResolvedValue({ ExitCode: 0 })
    }
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue(execInstance)
    }

    const { writeFileInContainer } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await writeFileInContainer(container, '/workspace/r/file.ts', 'content here')

    expect(container.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['tee', '/workspace/r/file.ts'],
        AttachStdin: true,
        Tty: false
      })
    )
    expect(execInstance.start).toHaveBeenCalledWith({ hijack: true, stdin: true })
    expect(mockStream.write).toHaveBeenCalledWith(Buffer.from('content here', 'utf8'))
    expect(mockStream.end).toHaveBeenCalled()
  })

  it('throws when tee exits with non-zero code', async () => {
    const execInstance = {
      start: vi.fn().mockResolvedValue({
        on(event: string, cb: (d?: Buffer) => void) {
          if (event === 'finish') setImmediate(() => cb())
          return this
        },
        write: vi.fn(),
        end: vi.fn()
      }),
      inspect: vi.fn().mockResolvedValue({ ExitCode: 1 })
    }
    const container = {
      id: 'c',
      exec: vi.fn().mockResolvedValue(execInstance)
    }
    const { writeFileInContainer } = await import('../../src/main/gitOps')
    // @ts-expect-error mock
    await expect(writeFileInContainer(container, '/workspace/r/file.ts', 'content'))
      .rejects.toThrow(/writeFileInContainer failed/)
  })
})

describe('listRemoteBranches', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
  })

  it('parses defaultBranch from symref line', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, 'ref: refs/heads/main\tHEAD\nabc123\tHEAD\nabc123\trefs/heads/main\ndef456\trefs/heads/develop\n', '')
    )
    const result = await listRemoteBranches('git@github.com:org/repo.git', 'PAT')
    expect(result.defaultBranch).toBe('main')
  })

  it('returns branch list sorted with default branch first', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, 'ref: refs/heads/main\tHEAD\nabc123\tHEAD\ndef456\trefs/heads/develop\nabc123\trefs/heads/main\nghi789\trefs/heads/feature/x\n', '')
    )
    const result = await listRemoteBranches('git@github.com:org/repo.git', 'PAT')
    expect(result.branches[0]).toBe('main')
    expect(result.branches).toContain('develop')
    expect(result.branches).toContain('feature/x')
  })

  it('falls back to first alphabetical branch when no symref line present', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, 'abc123\tHEAD\nabc123\trefs/heads/main\ndef456\trefs/heads/develop\n', '')
    )
    const result = await listRemoteBranches('git@github.com:org/repo.git', 'PAT')
    expect(result.defaultBranch).toBe('develop')
  })

  it('returns defaultBranch "main" and empty branches for empty output', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, '', '')
    )
    const result = await listRemoteBranches('git@github.com:org/repo.git', 'PAT')
    expect(result.defaultBranch).toBe('main')
    expect(result.branches).toEqual([])
  })

  it('uses HTTPS URL with PAT and passes --symref flag', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) =>
      cb(null, '', '')
    )
    await listRemoteBranches('git@github.com:org/repo.git', 'PAT')
    const call = mockExecFile.mock.calls[0]
    expect(call[0]).toBe('git')
    expect(call[1]).toEqual([
      'ls-remote',
      '--symref',
      'https://PAT@github.com/org/repo.git',
      'HEAD',
      'refs/heads/*'
    ])
  })

  it('rejects with scrubbed error on git failure', async () => {
    const err = Object.assign(new Error('auth failed for https://PAT@github.com/org/repo.git'), { code: 128 })
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => cb(err, '', ''))
    const rejection = await listRemoteBranches('git@github.com:org/repo.git', 'PAT').catch(e => e)
    expect(rejection).toBeInstanceOf(Error)
    expect(rejection.message).not.toContain('PAT')
  })
})
