import { execFile } from 'child_process'
import { promisify } from 'util'
import type Dockerode from 'dockerode'
import { sshUrlToHttps } from './gitUrl'
import { scrubPat } from './scrub'

const execFileAsync = promisify(execFile)

export async function applyGitIdentity(name: string, email: string): Promise<void> {
  await execFileAsync('git', ['config', '--global', 'user.name', name])
  await execFileAsync('git', ['config', '--global', 'user.email', email])
}

export interface GitResult {
  ok: boolean
  code: number
  stdout: string
}

type Container = ReturnType<Dockerode['getContainer']>

const BLOCKED_DIRS = new Set([
  'node_modules', '.venv', 'venv', '__pycache__', '.git',
  'dist', 'build', '.next', '.nuxt', 'target', 'coverage', 'out'
])

export async function listContainerDir(
  container: Container,
  dirPath: string
): Promise<{ name: string; isDir: boolean }[]> {
  const result = await execInContainer(container, ['ls', '-1p', dirPath])
  if (!result.ok) return []
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((entry) => {
      const isDir = entry.endsWith('/')
      const name = isDir ? entry.slice(0, -1) : entry
      return { name, isDir }
    })
    .filter(({ name, isDir }) => !(isDir && BLOCKED_DIRS.has(name)))
}

export async function readContainerFile(
  container: Container,
  filePath: string
): Promise<string> {
  const result = await execInContainer(container, ['cat', filePath])
  if (!result.ok) throw new Error(`readContainerFile failed (exit ${result.code}): ${filePath}`)
  return result.stdout
}

export async function writeFileInContainer(
  container: Container,
  filePath: string,
  content: string
): Promise<void> {
  const execInstance = await container.exec({
    Cmd: ['tee', filePath],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false
  })
  const stream = await execInstance.start({ hijack: true, stdin: true })
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject)
    stream.on('finish', resolve)
    stream.write(Buffer.from(content, 'utf8'))
    stream.end()
  })
  const info = await execInstance.inspect()
  if (info.ExitCode !== 0) {
    throw new Error(`writeFileInContainer failed (exit ${info.ExitCode}): ${filePath}`)
  }
}

export async function execInContainer(
  container: Container,
  cmd: string[],
  opts: { workingDir?: string } = {}
): Promise<GitResult> {
  const execInstance = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Env: ['TERM=dumb', 'GIT_TERMINAL_PROMPT=0'],
    WorkingDir: opts.workingDir
  })
  const stream = await execInstance.start({ Tty: true })

  let stdout = ''
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })

  const inspect = await execInstance.inspect()
  const code = inspect.ExitCode ?? 0
  // Docker TTY mode emits CRLF; normalize to LF so callers parsing line-by-line
  // (e.g. listContainerDir) don't carry stray '\r' that breaks suffix checks.
  return { ok: code === 0, code, stdout: stdout.replace(/\r\n/g, '\n') }
}

export async function remoteBranchExists(
  sshUrl: string,
  slug: string,
  pat: string
): Promise<boolean> {
  const httpsUrl = sshUrlToHttps(sshUrl, pat)
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile('git', ['ls-remote', '--heads', httpsUrl, slug], { timeout: 15_000 }, (err, out) => {
      if (err) {
        const scrubbed = new Error(scrubPat(err.message, pat))
        const origCode = (err as NodeJS.ErrnoException).code
        if (origCode !== undefined) {
          ;(scrubbed as NodeJS.ErrnoException).code = origCode
        }
        const origStderr = (err as Error & { stderr?: string }).stderr
        if (origStderr !== undefined) {
          ;(scrubbed as Error & { stderr?: string }).stderr = scrubPat(origStderr, pat)
        }
        reject(scrubbed)
      } else {
        resolve(String(out ?? ''))
      }
    })
  })
  return stdout.trim().length > 0
}

export async function cloneInContainer(
  container: Container,
  sshUrl: string,
  pat: string,
  clonePath: string
): Promise<void> {
  const httpsUrl = sshUrlToHttps(sshUrl, pat)
  const cloneResult = await execInContainer(container, ['git', 'clone', httpsUrl, clonePath])
  if (!cloneResult.ok) {
    throw new Error(`git clone failed: ${scrubPat(cloneResult.stdout, pat)}`)
  }

  const setUrl = await execInContainer(container, [
    'git',
    '-C',
    clonePath,
    'remote',
    'set-url',
    'origin',
    sshUrl
  ])
  if (!setUrl.ok) {
    throw new Error(`git remote set-url failed: ${scrubPat(setUrl.stdout, pat)}`)
  }
}

export async function checkoutSlug(
  container: Container,
  clonePath: string,
  slug: string,
  remoteHasSlug: boolean,
  pat?: string
): Promise<void> {
  const args = remoteHasSlug
    ? ['git', '-C', clonePath, 'checkout', slug]
    : ['git', '-C', clonePath, 'checkout', '-b', slug]
  const result = await execInContainer(container, args)
  if (!result.ok) {
    throw new Error(`git checkout failed: ${scrubPat(result.stdout, pat)}`)
  }
}

export async function getCurrentBranch(container: Container, clonePath: string): Promise<string> {
  const result = await execInContainer(container, [
    'git',
    '-C',
    clonePath,
    'rev-parse',
    '--abbrev-ref',
    'HEAD'
  ])
  return result.stdout.trim()
}

export interface GitStatus {
  isDirty: boolean
  added: number
  deleted: number
}

export async function getGitStatus(container: Container, clonePath: string): Promise<GitStatus> {
  const porcelainResult = await execInContainer(container, [
    'git', '-C', clonePath, 'status', '--porcelain'
  ])
  const isDirty = porcelainResult.ok && porcelainResult.stdout.trim().length > 0

  // added/deleted only count tracked-file diffs; untracked files make isDirty=true but contribute 0 here
  const shortstatResult = await execInContainer(container, [
    'git', '-C', clonePath, 'diff', '--shortstat', 'HEAD'
  ])

  let added = 0
  let deleted = 0
  if (shortstatResult.ok && shortstatResult.stdout.trim().length > 0) {
    const addedMatch = shortstatResult.stdout.match(/(\d+) insertion/)
    const deletedMatch = shortstatResult.stdout.match(/(\d+) deletion/)
    if (addedMatch) added = parseInt(addedMatch[1], 10)
    if (deletedMatch) deleted = parseInt(deletedMatch[1], 10)
  }

  return { isDirty, added, deleted }
}

export interface CommitInput {
  subject: string
  body?: string
  name: string
  email: string
}

export async function stageAndCommit(
  container: Container,
  clonePath: string,
  input: CommitInput
): Promise<GitResult> {
  const addResult = await execInContainer(container, ['git', '-C', clonePath, 'add', '--all'])
  if (!addResult.ok) return addResult

  const commitArgs = [
    'git',
    '-C',
    clonePath,
    '-c',
    `user.name=${input.name}`,
    '-c',
    `user.email=${input.email}`,
    'commit',
    '-m',
    input.subject
  ]
  if (input.body && input.body.trim().length > 0) {
    commitArgs.push('-m', input.body)
  }
  return execInContainer(container, commitArgs)
}

export async function push(
  container: Container,
  clonePath: string,
  branch: string,
  sshUrl: string,
  pat: string
): Promise<GitResult> {
  const httpsUrl = sshUrlToHttps(sshUrl, pat)
  const result = await execInContainer(container, [
    'git',
    '-C',
    clonePath,
    'push',
    '-u',
    httpsUrl,
    branch
  ])
  return {
    ...result,
    stdout: scrubPat(result.stdout, pat)
  }
}
