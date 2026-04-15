import { getDocker } from './docker'
import { execInContainer } from './gitOps'
import { getDb } from './db'
import { dispatchWaiting } from './waitingDispatcher'

// Every tick, each active terminal session is probed for the hook marker.
// 3s keeps the user-visible latency below what feels laggy while avoiding
// excessive docker-daemon chatter at realistic session counts.
const POLL_INTERVAL_MS = 3000
const MARKER = '/tmp/claude-waiting'

export function startWaitingPoller(): () => void {
  // Clear any markers left over from a previous app run before we start
  // firing notifications — otherwise a stale /tmp/claude-waiting would
  // alert on the first poll tick even though Claude idled before this
  // session started.
  void primeMarkers()
  const interval = setInterval(() => {
    void pollOnce()
  }, POLL_INTERVAL_MS)
  return () => clearInterval(interval)
}

export async function pollOnce(
  check: (id: string) => Promise<void> = checkOne
): Promise<void> {
  const ids = getMonitoredContainerIds()
  await Promise.allSettled(ids.map(check))
}

function getMonitoredContainerIds(): string[] {
  try {
    const rows = getDb()
      .prepare('SELECT container_id FROM windows WHERE deleted_at IS NULL')
      .all() as { container_id: string }[]
    return rows.map((r) => r.container_id)
  } catch {
    // DB not initialized yet (very early boot); skip this tick.
    return []
  }
}

async function primeMarkers(): Promise<void> {
  const ids = getMonitoredContainerIds()
  await Promise.allSettled(
    ids.map(async (id) => {
      try {
        await execInContainer(getDocker().getContainer(id), ['rm', '-f', MARKER])
      } catch {
        // Container gone / stopped; next tick is harmless.
      }
    })
  )
}

async function checkOne(containerId: string): Promise<void> {
  try {
    const container = getDocker().getContainer(containerId)
    const r = await execInContainer(container, [
      'sh',
      '-c',
      `test -e ${MARKER} && rm -f ${MARKER} && echo Y`
    ])
    if (r.ok && r.stdout.trim() === 'Y') dispatchWaiting(containerId)
  } catch {
    // Container gone / docker unreachable; next tick will retry naturally.
  }
}
