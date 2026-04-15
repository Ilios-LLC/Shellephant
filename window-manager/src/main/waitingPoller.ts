import { getDocker } from './docker'
import { execInContainer } from './gitOps'
import { getDb } from './db'
import { dispatchWaiting } from './waitingDispatcher'
import { dispatchSummary } from './summaryDispatcher'

const POLL_INTERVAL_MS = 3000
const MARKER = '/tmp/claude-waiting'
const SUMMARY_FILE = '/tmp/claude-summary.json'

export function startWaitingPoller(): () => void {
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

    // Check waiting marker
    const r = await execInContainer(container, [
      'sh',
      '-c',
      `test -e ${MARKER} && rm -f ${MARKER} && echo Y`
    ])
    if (r.ok && r.stdout.trim() === 'Y') dispatchWaiting(containerId)

    // Check summary file — read and delete atomically
    const s = await execInContainer(container, [
      'sh',
      '-c',
      `test -f ${SUMMARY_FILE} && cat ${SUMMARY_FILE} && rm -f ${SUMMARY_FILE}`
    ])
    if (s.ok && s.stdout.trim()) {
      try {
        const summary = JSON.parse(s.stdout.trim()) as { title: string; bullets: string[] }
        if (summary.title && Array.isArray(summary.bullets)) {
          dispatchSummary(containerId, summary)
        }
      } catch {
        // Malformed JSON — skip silently.
      }
    }
  } catch {
    // Container gone / docker unreachable; next tick will retry naturally.
  }
}
