import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Claude Code's Stop hook touches /tmp/claude-waiting inside the
// container. The host polls each active container every 3s with
// `test -e /tmp/claude-waiting && rm && echo Y`. No mounts involved.
// These tests exercise the literal hook command from
// files/claude-settings.json with the marker path remapped into a
// tempdir so we can observe it from the test runner.

const SETTINGS_PATH = join(__dirname, '../../../files/claude-settings.json')

function loadHookCommand(): string {
  const raw = readFileSync(SETTINGS_PATH, 'utf8')
  const parsed = JSON.parse(raw) as {
    hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> }
  }
  return parsed.hooks.Stop[0].hooks[0].command
}

function runHook(markerPath: string): void {
  const command = loadHookCommand().replaceAll('/tmp/claude-waiting', markerPath)
  execFileSync('/bin/sh', ['-c', command], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }
  })
}

describe('claude-settings.json Stop hook', () => {
  it('creates the marker file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-hook-'))
    try {
      const marker = join(dir, 'claude-waiting')
      runHook(marker)
      expect(existsSync(marker)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is idempotent — running twice keeps the marker present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-hook-'))
    try {
      const marker = join(dir, 'claude-waiting')
      runHook(marker)
      runHook(marker)
      expect(existsSync(marker)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when the parent directory is missing', () => {
    const missing = join(tmpdir(), 'cw-nonexistent-' + Date.now(), 'claude-waiting')
    expect(() => runHook(missing)).not.toThrow()
  })
})
