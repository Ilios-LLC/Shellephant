import { execFile } from 'child_process'
import type Dockerode from 'dockerode'
import { sshUrlToHttps } from './gitUrl'
import { scrubPat } from './scrub'

export interface GitResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

type Container = ReturnType<Dockerode['getContainer']>

export async function execInContainer(
  container: Container,
  cmd: string[],
  opts: { workingDir?: string } = {}
): Promise<GitResult> {
  const execInstance = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: opts.workingDir
  })
  const stream = await execInstance.start({})

  let stdout = ''
  const stderr = ''
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })

  const inspect = await execInstance.inspect()
  const code = inspect.ExitCode ?? 0
  return { ok: code === 0, code, stdout, stderr }
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
  const addResult = await execInContainer(container, [
    'git', '-C', clonePath, 'add', '--all'
  ])
  if (!addResult.ok) return addResult

  const commitArgs = [
    'git', '-C', clonePath,
    '-c', `user.name=${input.name}`,
    '-c', `user.email=${input.email}`,
    'commit',
    '-m', input.subject
  ]
  if (input.body && input.body.trim().length > 0) {
    commitArgs.push('-m', input.body)
  }
  return execInContainer(container, commitArgs)
}
