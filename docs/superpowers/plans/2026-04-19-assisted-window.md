# Assisted Window Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `assisted` window type where a Kimi 2.5 model (Fireworks AI) autonomously orchestrates Claude Code SDK sessions inside the dev container via a worker-thread-based chat interface.

**Architecture:** Each assisted window spawns a dedicated `worker_threads` worker (`assistedWindowWorker.ts`) that owns the Kimi orchestration loop. The main process (`assistedWindowService.ts`) manages a `Map<windowId, Worker>` and brokers IPC. Kimi has two tools: `run_claude_code` (runs `cw-claude-sdk.js` inside container via `docker exec`) and `ping_user` (pauses loop, OS notification, awaits user reply).

**Tech Stack:** Electron + better-sqlite3, Node.js worker_threads, openai npm package (Fireworks-compatible), @anthropic-ai/claude-code (in container), Svelte 5 runes, Vitest

---

## File Map

### New Files
- `window-manager/src/main/assistedWindowWorker.ts` — worker thread; full Kimi loop
- `window-manager/src/main/assistedWindowService.ts` — manages `Map<windowId, Worker>`, brokers IPC
- `window-manager/src/renderer/src/components/AssistedPanel.svelte` — chat UI component
- `window-manager/tests/main/assistedWindowService.test.ts`
- `window-manager/tests/main/assistedWindowWorker.test.ts`
- `window-manager/tests/renderer/AssistedPanel.test.ts`
- `files/cw-claude-sdk.js` — baked into `cc` container image; runs Claude Code SDK

### Modified Files
- `window-manager/src/main/db.ts` — migrations: `window_type` on `windows`, `kimi_system_prompt` on `projects`, new `assisted_messages` table
- `window-manager/src/renderer/src/types.ts` — add `window_type` to `WindowRecord`, `kimi_system_prompt` to `ProjectRecord`, new `AssistedMessage` type; add new API methods to `Api`
- `window-manager/src/main/settingsService.ts` — Fireworks key (encrypted) + global Kimi system prompt (plain)
- `window-manager/src/main/ipcHandlers.ts` — handlers for `settings:*-fireworks-key`, `settings:*-kimi-prompt`, `project:set-kimi-prompt`, `assisted:send`, `assisted:cancel`, `assisted:history`
- `window-manager/src/main/windowService.ts` — propagate `window_type` through create/list; validate Fireworks key for assisted windows
- `window-manager/src/preload/index.ts` — expose new IPC channels
- `window-manager/src/renderer/src/components/SettingsView.svelte` — Fireworks API key section
- `window-manager/src/renderer/src/components/NewWindowWizard.svelte` — Manual/Assisted type toggle
- `window-manager/src/renderer/src/components/TerminalHost.svelte` — render `AssistedPanel` for assisted windows
- `window-manager/src/renderer/src/components/WindowDetailPane.svelte` — hide Claude toggle for assisted windows
- `files/Dockerfile` — install `@anthropic-ai/claude-code` globally + copy `cw-claude-sdk.js`

---

## Task 1: DB Migrations

**Files:**
- Modify: `window-manager/src/main/db.ts`
- Test: `window-manager/tests/main/db.test.ts` (create if not exists)

- [ ] **Step 1: Write failing tests for new schema**

Create `window-manager/tests/main/db.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, getDb, closeDb } from '../../src/main/db'
import Database from 'better-sqlite3'
import os from 'os'
import path from 'path'
import fs from 'fs'

let tmpPath: string

beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `test-db-${Date.now()}.sqlite`)
  initDb(tmpPath)
})

afterEach(() => {
  closeDb()
  fs.unlinkSync(tmpPath)
})

describe('windows table', () => {
  it('has window_type column defaulting to manual', () => {
    const db = getDb()
    db.exec("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:x/y.git')")
    const projId = (db.prepare('SELECT id FROM projects').get() as { id: number }).id
    db.exec(`INSERT INTO windows (name, project_id, container_id) VALUES ('w', ${projId}, 'c1')`)
    const row = db.prepare('SELECT window_type FROM windows WHERE container_id = ?').get('c1') as { window_type: string }
    expect(row.window_type).toBe('manual')
  })

  it('accepts assisted as window_type', () => {
    const db = getDb()
    db.exec("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:x/y.git')")
    const projId = (db.prepare('SELECT id FROM projects').get() as { id: number }).id
    db.exec(`INSERT INTO windows (name, project_id, container_id, window_type) VALUES ('w', ${projId}, 'c2', 'assisted')`)
    const row = db.prepare('SELECT window_type FROM windows WHERE container_id = ?').get('c2') as { window_type: string }
    expect(row.window_type).toBe('assisted')
  })
})

describe('projects table', () => {
  it('has kimi_system_prompt column defaulting to null', () => {
    const db = getDb()
    db.exec("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:x/y.git')")
    const row = db.prepare('SELECT kimi_system_prompt FROM projects WHERE name = ?').get('p') as { kimi_system_prompt: string | null }
    expect(row.kimi_system_prompt).toBeNull()
  })
})

describe('assisted_messages table', () => {
  it('stores messages with role and content', () => {
    const db = getDb()
    db.exec("INSERT INTO projects (name, git_url) VALUES ('p', 'git@github.com:x/y.git')")
    const projId = (db.prepare('SELECT id FROM projects').get() as { id: number }).id
    db.exec(`INSERT INTO windows (name, project_id, container_id) VALUES ('w', ${projId}, 'c3')`)
    const winId = (db.prepare('SELECT id FROM windows WHERE container_id = ?').get('c3') as { id: number }).id
    db.exec(`INSERT INTO assisted_messages (window_id, role, content) VALUES (${winId}, 'user', 'hello')`)
    const row = db.prepare('SELECT role, content FROM assisted_messages WHERE window_id = ?').get(winId) as { role: string; content: string }
    expect(row.role).toBe('user')
    expect(row.content).toBe('hello')
  })

  it('stores metadata JSON', () => {
    const db = getDb()
    db.exec("INSERT INTO projects (name, git_url) VALUES ('p2', 'git@github.com:x/z.git')")
    const projId = (db.prepare("SELECT id FROM projects WHERE name='p2'").get() as { id: number }).id
    db.exec(`INSERT INTO windows (name, project_id, container_id) VALUES ('w2', ${projId}, 'c4')`)
    const winId = (db.prepare('SELECT id FROM windows WHERE container_id = ?').get('c4') as { id: number }).id
    const meta = JSON.stringify({ session_id: 'abc123', complete: true })
    db.exec(`INSERT INTO assisted_messages (window_id, role, content, metadata) VALUES (${winId}, 'tool_result', 'output', '${meta}')`)
    const row = db.prepare('SELECT metadata FROM assisted_messages WHERE window_id = ?').get(winId) as { metadata: string }
    expect(JSON.parse(row.metadata).session_id).toBe('abc123')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/db.test.ts
```
Expected: FAIL — `window_type`, `kimi_system_prompt`, `assisted_messages` not in schema.

- [ ] **Step 3: Add migrations to db.ts**

In `runColumnMigrations`, add after existing checks:
```typescript
  if (!col(db, 'windows').includes('window_type')) {
    db.exec("ALTER TABLE windows ADD COLUMN window_type TEXT NOT NULL DEFAULT 'manual'")
  }
  if (!col(db, 'projects').includes('kimi_system_prompt')) {
    db.exec('ALTER TABLE projects ADD COLUMN kimi_system_prompt TEXT DEFAULT NULL')
  }
```

In `initDb`, after the `window_dependency_containers` CREATE and before `runColumnMigrations`, add:
```typescript
  _db.exec(`
    CREATE TABLE IF NOT EXISTS assisted_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      window_id  INTEGER NOT NULL REFERENCES windows(id),
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      metadata   TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/db.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/db.ts window-manager/tests/main/db.test.ts
git commit -m "feat: add assisted window DB migrations"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `window-manager/src/renderer/src/types.ts`

- [ ] **Step 1: Add `window_type` to `WindowRecord`**

In `types.ts`, update `WindowRecord`:
```typescript
export interface WindowRecord {
  id: number
  name: string
  project_id: number | null
  container_id: string
  ports?: string
  network_id?: string | null
  window_type: 'manual' | 'assisted'
  created_at: string
  status: WindowStatus
  projects: WindowProjectRecord[]
}
```

- [ ] **Step 2: Add `kimi_system_prompt` to `ProjectRecord`**

```typescript
export interface ProjectRecord {
  id: number
  name: string
  git_url: string
  ports?: string
  env_vars?: string | null
  group_id?: number | null
  kimi_system_prompt?: string | null
  created_at: string
}
```

- [ ] **Step 3: Add `AssistedMessage` type**

After `WindowProjectRecord`, add:
```typescript
export interface AssistedMessage {
  id: number
  window_id: number
  role: 'user' | 'assistant' | 'tool_result' | 'ping_user'
  content: string
  metadata: string | null
  created_at: string
}
```

- [ ] **Step 4: Extend the `Api` interface with new methods**

In the `Api` interface, add:
```typescript
  // Assisted window API
  assistedSend: (windowId: number, message: string) => Promise<void>
  assistedCancel: (windowId: number) => Promise<void>
  assistedHistory: (windowId: number) => Promise<AssistedMessage[]>
  onAssistedStreamChunk: (callback: (windowId: number, chunk: string) => void) => void
  offAssistedStreamChunk: () => void
  onAssistedKimiDelta: (callback: (windowId: number, delta: string) => void) => void
  offAssistedKimiDelta: () => void
  onAssistedPingUser: (callback: (windowId: number, message: string) => void) => void
  offAssistedPingUser: () => void
  onAssistedTurnComplete: (callback: (windowId: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => void) => void
  offAssistedTurnComplete: () => void
  assistedResume: (windowId: number, message: string) => Promise<void>

  // Settings — Fireworks
  getFireworksKeyStatus: () => Promise<TokenStatus>
  setFireworksKey: (key: string) => Promise<TokenStatus>
  clearFireworksKey: () => Promise<TokenStatus>

  // Settings — Kimi system prompt
  getKimiSystemPrompt: () => Promise<string | null>
  setKimiSystemPrompt: (prompt: string) => Promise<void>
  setProjectKimiSystemPrompt: (projectId: number, prompt: string | null) => Promise<void>
```

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/types.ts
git commit -m "feat: add assisted window types to TypeScript interfaces"
```

---

## Task 3: Container Image — cw-claude-sdk.js

**Files:**
- Create: `files/cw-claude-sdk.js`
- Modify: `files/Dockerfile`

- [ ] **Step 1: Write `cw-claude-sdk.js`**

Create `files/cw-claude-sdk.js`:
```javascript
#!/usr/bin/env node
// Runs a single Claude Code SDK turn inside the container.
// Usage: node cw-claude-sdk.js <session_id|new> <message...>
// Streams JSON message lines to stdout. Writes final session_id to stderr.
'use strict'

const { query } = require('@anthropic-ai/claude-code')

async function main() {
  const rawSessionId = process.argv[2]
  const sessionId = (!rawSessionId || rawSessionId === 'new') ? undefined : rawSessionId
  const message = process.argv.slice(3).join(' ')

  if (!message) {
    process.stderr.write('ERROR: no message provided\n')
    process.exit(1)
  }

  let lastSessionId = null

  const options = {
    dangerouslySkipPermissions: true,
    ...(sessionId ? { resume: sessionId } : {})
  }

  for await (const msg of query({ prompt: message, options })) {
    process.stdout.write(JSON.stringify(msg) + '\n')
    if (msg.session_id) lastSessionId = msg.session_id
  }

  process.stderr.write(lastSessionId ?? '')
}

main().catch((err) => {
  process.stderr.write('ERROR: ' + err.message + '\n')
  process.exit(1)
})
```

- [ ] **Step 2: Update Dockerfile to install @anthropic/claude-code and copy script**

In `files/Dockerfile`, after the `RUN npm install -g pnpm` line (around line 142), add:
```dockerfile
# Install Claude Code SDK for programmatic access by assisted windows
RUN npm install -g @anthropic-ai/claude-code
```

After the `COPY --chown=node:node tmux.conf /home/node/.tmux.conf` line, add (as root section):
```dockerfile
# Copy Claude Code SDK runner script
COPY cw-claude-sdk.js /usr/local/bin/cw-claude-sdk.js
RUN chmod +x /usr/local/bin/cw-claude-sdk.js
```

Note: The `COPY cw-claude-sdk.js` line must be placed in a `USER root` block or before the `USER node` switch. Check the Dockerfile — add it near the other root-level COPY commands around line 204-210:
```dockerfile
COPY cw-claude-sdk.js /usr/local/bin/cw-claude-sdk.js
RUN chmod +x /usr/local/bin/cw-claude-sdk.js
```

- [ ] **Step 3: Commit**

```bash
cd /workspace/claude-window && git add files/cw-claude-sdk.js files/Dockerfile
git commit -m "feat: add cw-claude-sdk.js and install @anthropic-ai/claude-code in container"
```

---

## Task 4: Fireworks Key and Kimi Prompt Settings Backend

**Files:**
- Modify: `window-manager/src/main/settingsService.ts`
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Modify: `window-manager/src/preload/index.ts`
- Test: `window-manager/tests/main/settingsService.test.ts` (create or extend)

- [ ] **Step 1: Write failing tests**

Create `window-manager/tests/main/settingsService.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { initDb, closeDb } from '../../src/main/db'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

let tmpPath: string

beforeEach(() => {
  tmpPath = path.join(os.tmpdir(), `test-settings-${Date.now()}.sqlite`)
  initDb(tmpPath)
})

afterEach(() => {
  closeDb()
  fs.unlinkSync(tmpPath)
})

describe('Fireworks key', () => {
  it('getFireworksKeyStatus returns not configured initially', async () => {
    const { getFireworksKeyStatus } = await import('../../src/main/settingsService')
    expect(getFireworksKeyStatus().configured).toBe(false)
  })

  it('setFireworksKey stores and status returns configured with hint', async () => {
    const { setFireworksKey, getFireworksKeyStatus } = await import('../../src/main/settingsService')
    setFireworksKey('fw-test-key-1234')
    const status = getFireworksKeyStatus()
    expect(status.configured).toBe(true)
    expect(status.hint).toBe('1234')
  })

  it('clearFireworksKey removes key', async () => {
    const { setFireworksKey, clearFireworksKey, getFireworksKeyStatus } = await import('../../src/main/settingsService')
    setFireworksKey('fw-test-key-abcd')
    clearFireworksKey()
    expect(getFireworksKeyStatus().configured).toBe(false)
  })
})

describe('Kimi system prompt', () => {
  it('getKimiSystemPrompt returns null initially', async () => {
    const { getKimiSystemPrompt } = await import('../../src/main/settingsService')
    expect(getKimiSystemPrompt()).toBeNull()
  })

  it('setKimiSystemPrompt stores plain text', async () => {
    const { setKimiSystemPrompt, getKimiSystemPrompt } = await import('../../src/main/settingsService')
    setKimiSystemPrompt('You are a helpful assistant.')
    expect(getKimiSystemPrompt()).toBe('You are a helpful assistant.')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/settingsService.test.ts
```
Expected: FAIL — functions not exported.

- [ ] **Step 3: Add Fireworks key and Kimi prompt to settingsService.ts**

Add to `window-manager/src/main/settingsService.ts`:
```typescript
const FIREWORKS_KEY = 'fireworks_api_key'
const KIMI_PROMPT_KEY = 'kimi_system_prompt'

function getPlainSetting(key: string): string | null {
  const row = readRow(key)
  if (!row) return null
  return row.toString('utf8')
}

function setPlainSetting(key: string, value: string): void {
  writeRow(key, Buffer.from(value, 'utf8'))
}

export function getFireworksKey(): string | null {
  return getSecret(FIREWORKS_KEY)
}

export function getFireworksKeyStatus(): TokenStatus {
  return statusFor(FIREWORKS_KEY)
}

export function setFireworksKey(key: string): void {
  setSecret(FIREWORKS_KEY, key)
}

export function clearFireworksKey(): void {
  deleteRow(FIREWORKS_KEY)
}

export function getKimiSystemPrompt(): string | null {
  return getPlainSetting(KIMI_PROMPT_KEY)
}

export function setKimiSystemPrompt(prompt: string): void {
  setPlainSetting(KIMI_PROMPT_KEY, prompt)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/settingsService.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Add IPC handlers in ipcHandlers.ts**

In `window-manager/src/main/ipcHandlers.ts`, import the new functions and add handlers (follow existing pattern):
```typescript
import {
  getFireworksKey, getFireworksKeyStatus, setFireworksKey, clearFireworksKey,
  getKimiSystemPrompt, setKimiSystemPrompt
} from './settingsService'
import { getDb } from './db'

// Inside the registration function, add:
ipcMain.handle('settings:get-fireworks-key-status', () => getFireworksKeyStatus())
ipcMain.handle('settings:set-fireworks-key', (_, key: string) => {
  setFireworksKey(key)
  return getFireworksKeyStatus()
})
ipcMain.handle('settings:clear-fireworks-key', () => {
  clearFireworksKey()
  return getFireworksKeyStatus()
})
ipcMain.handle('settings:get-kimi-system-prompt', () => getKimiSystemPrompt())
ipcMain.handle('settings:set-kimi-system-prompt', (_, prompt: string) => {
  setKimiSystemPrompt(prompt)
})
ipcMain.handle('project:set-kimi-system-prompt', (_, projectId: number, prompt: string | null) => {
  getDb()
    .prepare('UPDATE projects SET kimi_system_prompt = ? WHERE id = ?')
    .run(prompt, projectId)
})
```

- [ ] **Step 6: Expose new channels in preload/index.ts**

Add to the `contextBridge.exposeInMainWorld('api', { ... })` object:
```typescript
  // Fireworks API key
  getFireworksKeyStatus: () => ipcRenderer.invoke('settings:get-fireworks-key-status'),
  setFireworksKey: (key: string) => ipcRenderer.invoke('settings:set-fireworks-key', key),
  clearFireworksKey: () => ipcRenderer.invoke('settings:clear-fireworks-key'),

  // Kimi system prompt
  getKimiSystemPrompt: () => ipcRenderer.invoke('settings:get-kimi-system-prompt'),
  setKimiSystemPrompt: (prompt: string) => ipcRenderer.invoke('settings:set-kimi-system-prompt', prompt),
  setProjectKimiSystemPrompt: (projectId: number, prompt: string | null) =>
    ipcRenderer.invoke('project:set-kimi-system-prompt', projectId, prompt),
```

- [ ] **Step 7: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/settingsService.ts window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts window-manager/tests/main/settingsService.test.ts
git commit -m "feat: add Fireworks API key and Kimi system prompt settings"
```

---

## Task 5: windowService.ts — window_type Support

**Files:**
- Modify: `window-manager/src/main/windowService.ts`
- Test: extend `window-manager/tests/main/windowService.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `window-manager/tests/main/windowService.test.ts` (find the describe block and add tests):
```typescript
it('createWindow stores manual type by default', async () => {
  // Use existing mock setup from the test file
  const win = await createWindow('test', [mockProjectId], false, {})
  expect(win.window_type).toBe('manual')
})

it('createWindow stores assisted type when specified', async () => {
  const win = await createWindow('test', [mockProjectId], false, {}, undefined, 'assisted')
  expect(win.window_type).toBe('assisted')
})

it('listWindows returns window_type field', async () => {
  await createWindow('test', [mockProjectId])
  const wins = listWindows()
  expect(wins[0].window_type).toBeDefined()
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/windowService.test.ts 2>&1 | tail -20
```
Expected: new tests fail, existing pass.

- [ ] **Step 3: Update WindowRecord type in windowService.ts**

In `window-manager/src/main/windowService.ts`, update the `WindowRecord` interface:
```typescript
export interface WindowRecord {
  id: number
  name: string
  project_id: number | null
  container_id: string
  ports?: string
  network_id?: string
  window_type: 'manual' | 'assisted'
  created_at: string
  status: WindowStatus
  projects: WindowProjectRecord[]
}
```

- [ ] **Step 4: Update createWindow signature and persistWindow**

In `windowService.ts`, update `createWindow` signature:
```typescript
export async function createWindow(
  name: string,
  projectIds: number[],
  withDeps: boolean = false,
  branchOverrides: Record<number, string> = {},
  onProgress?: ProgressReporter,
  windowType: 'manual' | 'assisted' = 'manual'
): Promise<WindowRecord>
```

Update `persistWindow` helper (or the inline INSERT) to include `window_type`:
```typescript
// In persistWindow or wherever the INSERT INTO windows happens:
const result = db
  .prepare(
    `INSERT INTO windows (name, project_id, container_id, ports, window_type)
     VALUES (?, ?, ?, ?, ?)`
  )
  .run(name, singleProjectId ?? null, containerId, portsJson, windowType)
```

Update `listWindows` query to include `window_type` in SELECT.

Update the row-to-record mapping to include `window_type`.

- [ ] **Step 5: Update ipcHandlers.ts window:create handler**

Find `ipcMain.handle('window:create', ...)` and update to pass `windowType`:
```typescript
ipcMain.handle(
  'window:create',
  async (event, name: string, projectIds: number[], withDeps: boolean, branchOverrides: Record<number, string>, windowType: 'manual' | 'assisted' = 'manual') => {
    // validate Fireworks key for assisted windows
    if (windowType === 'assisted') {
      const { getFireworksKey } = await import('./settingsService')
      if (!getFireworksKey()) {
        throw new Error('Fireworks API key not configured. Set it in Settings.')
      }
    }
    return createWindow(name, projectIds, withDeps, branchOverrides, reporter, windowType)
  }
)
```

Update preload `createWindow`:
```typescript
createWindow: (name: string, projectIds: number[], withDeps: boolean = false, branchOverrides: Record<number, string> = {}, windowType: 'manual' | 'assisted' = 'manual') =>
  ipcRenderer.invoke('window:create', name, projectIds, withDeps, branchOverrides, windowType),
```

- [ ] **Step 6: Run tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/windowService.test.ts
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/windowService.ts window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts window-manager/tests/main/windowService.test.ts
git commit -m "feat: add window_type to windowService create/list"
```

---

## Task 6: assistedWindowWorker.ts — Kimi Loop

**Files:**
- Create: `window-manager/src/main/assistedWindowWorker.ts`
- Test: `window-manager/tests/main/assistedWindowWorker.test.ts`

- [ ] **Step 1: Install openai package**

```bash
cd /workspace/claude-window/window-manager && npm install openai
```

- [ ] **Step 2: Write failing tests**

Create `window-manager/tests/main/assistedWindowWorker.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock worker_threads parentPort
const mockParentPort = { postMessage: vi.fn(), on: vi.fn() }
vi.mock('worker_threads', () => ({
  parentPort: mockParentPort,
  workerData: {}
}))

// Mock child_process for docker exec
const mockSpawn = vi.fn()
vi.mock('child_process', () => ({ spawn: mockSpawn }))

// Mock openai
const mockCreate = vi.fn()
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } }
  }))
}))

import { resolveSystemPrompt, buildKimiTools, parseDockerOutput } from '../../src/main/assistedWindowWorker'

describe('resolveSystemPrompt', () => {
  it('returns project prompt when set', () => {
    const result = resolveSystemPrompt('project prompt', null)
    expect(result).toBe('project prompt')
  })

  it('returns global prompt when project not set', () => {
    const result = resolveSystemPrompt(null, 'global prompt')
    expect(result).toBe('global prompt')
  })

  it('returns default prompt when both null', () => {
    const result = resolveSystemPrompt(null, null)
    expect(result).toContain('autonomous coding assistant')
  })
})

describe('buildKimiTools', () => {
  it('returns array with run_claude_code and ping_user tools', () => {
    const tools = buildKimiTools()
    const names = tools.map((t: { function: { name: string } }) => t.function.name)
    expect(names).toContain('run_claude_code')
    expect(names).toContain('ping_user')
  })
})

describe('parseDockerOutput', () => {
  it('splits stdout lines and extracts session id from stderr', () => {
    const result = parseDockerOutput('line1\nline2\n', 'session-abc')
    expect(result.outputLines).toEqual(['line1', 'line2'])
    expect(result.sessionId).toBe('session-abc')
  })

  it('returns null sessionId when stderr is empty', () => {
    const result = parseDockerOutput('output', '')
    expect(result.sessionId).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/assistedWindowWorker.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Create assistedWindowWorker.ts**

Create `window-manager/src/main/assistedWindowWorker.ts`:
```typescript
import { parentPort } from 'worker_threads'
import { spawn } from 'child_process'
import OpenAI from 'openai'

const DEFAULT_SYSTEM_PROMPT = `You are an autonomous coding assistant orchestrating a Claude Code session inside a development container.
Use run_claude_code to execute coding tasks. Use ping_user only when you genuinely cannot proceed without human input — prefer to resolve ambiguity yourself.
When the task is complete, summarize what was accomplished.`

export function resolveSystemPrompt(
  projectPrompt: string | null,
  globalPrompt: string | null
): string {
  return projectPrompt ?? globalPrompt ?? DEFAULT_SYSTEM_PROMPT
}

export function buildKimiTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'run_claude_code',
        description: 'Send a message to the Claude Code SDK session inside the container. Pass null session_id to start a new session.',
        parameters: {
          type: 'object',
          properties: {
            session_id: { type: ['string', 'null'], description: 'Existing session ID, or null to start new' },
            message: { type: 'string', description: 'The task or message for Claude Code' }
          },
          required: ['session_id', 'message']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'ping_user',
        description: 'Send a message to the user and pause until they respond. Use only when you cannot proceed without human input.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The question or information for the user' }
          },
          required: ['message']
        }
      }
    }
  ]
}

export function parseDockerOutput(stdout: string, stderr: string): { outputLines: string[]; sessionId: string | null } {
  const outputLines = stdout.split('\n').filter(l => l.trim())
  const sessionId = stderr.trim() || null
  return { outputLines, sessionId }
}

async function runClaudeCode(
  containerId: string,
  sessionId: string | null,
  message: string
): Promise<{ output: string; newSessionId: string | null }> {
  return new Promise((resolve, reject) => {
    const sidArg = sessionId ?? 'new'
    const child = spawn('docker', ['exec', containerId, 'node', '/usr/local/bin/cw-claude-sdk.js', sidArg, message])

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      parentPort?.postMessage({ type: 'stream-chunk', chunk: text })
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`docker exec failed (exit ${code}): ${stderr}`))
        return
      }
      const { outputLines, sessionId: newSessionId } = parseDockerOutput(stdout, stderr)
      resolve({ output: outputLines.join('\n'), newSessionId })
    })

    child.on('error', reject)
  })
}

async function kimiLoop(data: {
  windowId: number
  containerId: string
  message: string
  conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  systemPrompt: string
  fireworksKey: string
}): Promise<void> {
  const { windowId, containerId, message, conversationHistory, systemPrompt, fireworksKey } = data

  const client = new OpenAI({
    apiKey: fireworksKey,
    baseURL: 'https://api.fireworks.ai/inference/v1'
  })

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: message }
  ]

  parentPort?.postMessage({ type: 'save-message', windowId, role: 'user', content: message, metadata: null })

  let activeSessionId: string | null = null
  let totalInputTokens = 0
  let totalOutputTokens = 0

  while (true) {
    let kimiDelta = ''

    const stream = await client.chat.completions.create({
      model: 'accounts/fireworks/models/kimi-k2-instruct',
      messages,
      tools: buildKimiTools(),
      stream: true
    })

    const toolCalls: { id: string; name: string; arguments: string }[] = []
    let currentToolCallIndex = -1

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (delta.content) {
        kimiDelta += delta.content
        parentPort?.postMessage({ type: 'kimi-delta', windowId, delta: delta.content })
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index !== undefined && tc.index !== currentToolCallIndex) {
            currentToolCallIndex = tc.index
            toolCalls[tc.index] = { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' }
          }
          if (tc.function?.arguments) {
            toolCalls[currentToolCallIndex].arguments += tc.function.arguments
          }
          if (tc.id) toolCalls[currentToolCallIndex].id = tc.id
          if (tc.function?.name) toolCalls[currentToolCallIndex].name = tc.function.name
        }
      }

      if (chunk.usage) {
        totalInputTokens += chunk.usage.prompt_tokens ?? 0
        totalOutputTokens += chunk.usage.completion_tokens ?? 0
      }
    }

    if (kimiDelta) {
      messages.push({ role: 'assistant', content: kimiDelta })
      parentPort?.postMessage({
        type: 'save-message', windowId, role: 'assistant', content: kimiDelta,
        metadata: JSON.stringify({ input_tokens: totalInputTokens, output_tokens: totalOutputTokens })
      })
    }

    if (toolCalls.length === 0) break

    const assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: 'assistant',
      content: kimiDelta || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments }
      }))
    }
    messages.push(assistantMessage)

    for (const tc of toolCalls) {
      let toolResult: string

      if (tc.name === 'ping_user') {
        const args = JSON.parse(tc.arguments) as { message: string }
        parentPort?.postMessage({ type: 'ping-user', windowId, message: args.message })
        parentPort?.postMessage({
          type: 'save-message', windowId, role: 'ping_user', content: args.message, metadata: null
        })

        const userReply = await new Promise<string>((resolve) => {
          parentPort?.once('message', (msg: { type: string; message: string }) => {
            if (msg.type === 'resume') resolve(msg.message)
          })
        })

        toolResult = userReply
        messages.push({ role: 'user', content: userReply })
        parentPort?.postMessage({
          type: 'save-message', windowId, role: 'user', content: userReply, metadata: null
        })
      } else if (tc.name === 'run_claude_code') {
        const args = JSON.parse(tc.arguments) as { session_id: string | null; message: string }
        let output: string
        let newSessionId: string | null = null

        try {
          const result = await runClaudeCode(containerId, args.session_id ?? activeSessionId, args.message)
          output = result.output
          newSessionId = result.newSessionId ?? activeSessionId
          activeSessionId = newSessionId
        } catch (err) {
          output = `ERROR: ${err instanceof Error ? err.message : String(err)}`
        }

        toolResult = output
        parentPort?.postMessage({
          type: 'save-message', windowId, role: 'tool_result', content: output,
          metadata: JSON.stringify({ session_id: activeSessionId, complete: true, tool_name: 'run_claude_code' })
        })
      } else {
        toolResult = 'Unknown tool'
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolResult
      })
    }
  }

  const costUsd = (totalInputTokens * 0.000001) + (totalOutputTokens * 0.000003)
  parentPort?.postMessage({
    type: 'turn-complete',
    windowId,
    stats: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd }
  })
}

parentPort?.on('message', async (msg: { type: string } & Record<string, unknown>) => {
  if (msg.type === 'send') {
    try {
      await kimiLoop(msg as Parameters<typeof kimiLoop>[0])
    } catch (err) {
      parentPort?.postMessage({
        type: 'turn-complete',
        windowId: (msg as { windowId: number }).windowId,
        stats: null,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }
})
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/assistedWindowWorker.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/assistedWindowWorker.ts window-manager/tests/main/assistedWindowWorker.test.ts window-manager/package-lock.json window-manager/package.json
git commit -m "feat: add assistedWindowWorker Kimi orchestration loop"
```

---

## Task 7: assistedWindowService.ts — Worker Management + IPC

**Files:**
- Create: `window-manager/src/main/assistedWindowService.ts`
- Modify: `window-manager/src/main/ipcHandlers.ts`
- Test: `window-manager/tests/main/assistedWindowService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `window-manager/tests/main/assistedWindowService.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockWorkerOn = vi.fn()
const mockWorkerPostMessage = vi.fn()
const mockWorkerTerminate = vi.fn()
const MockWorker = vi.fn().mockImplementation(() => ({
  on: mockWorkerOn,
  postMessage: mockWorkerPostMessage,
  terminate: mockWorkerTerminate
}))

vi.mock('worker_threads', () => ({ Worker: MockWorker }))

vi.mock('../../src/main/settingsService', () => ({
  getFireworksKey: vi.fn().mockReturnValue('fw-test-key'),
  getKimiSystemPrompt: vi.fn().mockReturnValue(null)
}))

vi.mock('../../src/main/db', () => ({
  getDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), run: vi.fn(), get: vi.fn() })
  })
}))

import { sendToWindow, cancelWindow, getWorkerCount } from '../../src/main/assistedWindowService'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendToWindow', () => {
  it('spawns a worker for a new window', async () => {
    await sendToWindow(1, 'container-abc', 'hello', null, vi.fn())
    expect(MockWorker).toHaveBeenCalledOnce()
  })

  it('reuses existing worker for same window', async () => {
    await sendToWindow(2, 'container-def', 'msg1', null, vi.fn())
    await sendToWindow(2, 'container-def', 'msg2', null, vi.fn())
    expect(MockWorker).toHaveBeenCalledTimes(1)
  })
})

describe('cancelWindow', () => {
  it('terminates the worker and removes from map', async () => {
    await sendToWindow(3, 'container-ghi', 'start', null, vi.fn())
    cancelWindow(3)
    expect(mockWorkerTerminate).toHaveBeenCalledOnce()
    expect(getWorkerCount()).toBe(0)
  })

  it('does nothing if no worker for window', () => {
    expect(() => cancelWindow(999)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/assistedWindowService.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create assistedWindowService.ts**

Create `window-manager/src/main/assistedWindowService.ts`:
```typescript
import { Worker } from 'worker_threads'
import path from 'path'
import { BrowserWindow } from 'electron'
import { Notification } from 'electron'
import { getFireworksKey, getKimiSystemPrompt } from './settingsService'
import { getDb } from './db'
import { isUserWatching } from './focusState'

const workers = new Map<number, Worker>()

export function getWorkerCount(): number {
  return workers.size
}

function getWorkerPath(): string {
  return path.join(__dirname, 'assistedWindowWorker.js')
}

function loadHistory(windowId: number): { role: string; content: string }[] {
  return getDb()
    .prepare('SELECT role, content FROM assisted_messages WHERE window_id = ? ORDER BY created_at ASC')
    .all(windowId) as { role: string; content: string }[]
}

function saveMessage(windowId: number, role: string, content: string, metadata: string | null): void {
  getDb()
    .prepare('INSERT INTO assisted_messages (window_id, role, content, metadata) VALUES (?, ?, ?, ?)')
    .run(windowId, role, content, metadata)
}

function resolveProjectSystemPrompt(projectId: number | null): string | null {
  if (!projectId) return null
  const row = getDb()
    .prepare('SELECT kimi_system_prompt FROM projects WHERE id = ?')
    .get(projectId) as { kimi_system_prompt: string | null } | undefined
  return row?.kimi_system_prompt ?? null
}

export async function sendToWindow(
  windowId: number,
  containerId: string,
  message: string,
  projectId: number | null,
  sendToRenderer: (channel: string, ...args: unknown[]) => void
): Promise<void> {
  const fireworksKey = getFireworksKey()
  if (!fireworksKey) throw new Error('Fireworks API key not configured')

  const projectPrompt = resolveProjectSystemPrompt(projectId)
  const globalPrompt = getKimiSystemPrompt()

  const history = loadHistory(windowId)

  let worker = workers.get(windowId)
  if (!worker) {
    worker = new Worker(getWorkerPath())

    worker.on('message', (msg: { type: string } & Record<string, unknown>) => {
      if (msg.type === 'save-message') {
        saveMessage(windowId, msg.role as string, msg.content as string, msg.metadata as string | null)
      } else if (msg.type === 'stream-chunk') {
        sendToRenderer('assisted:stream-chunk', windowId, msg.chunk)
      } else if (msg.type === 'kimi-delta') {
        sendToRenderer('assisted:kimi-delta', windowId, msg.delta)
      } else if (msg.type === 'ping-user') {
        sendToRenderer('assisted:ping-user', windowId, msg.message)
        const focusedWin = BrowserWindow.getFocusedWindow()
        if (!focusedWin || !isUserWatching(containerId, focusedWin)) {
          new Notification({ title: 'Kimi needs your input', body: msg.message as string }).show()
        }
      } else if (msg.type === 'turn-complete') {
        sendToRenderer('assisted:turn-complete', windowId, msg.stats, msg.error)
        workers.delete(windowId)
      }
    })

    worker.on('error', (err) => {
      sendToRenderer('assisted:turn-complete', windowId, null, err.message)
      workers.delete(windowId)
    })

    worker.on('exit', (code) => {
      if (code !== 0 && workers.has(windowId)) {
        sendToRenderer('assisted:turn-complete', windowId, null, `Worker exited with code ${code}`)
        workers.delete(windowId)
      }
    })

    workers.set(windowId, worker)
  }

  worker.postMessage({
    type: 'send',
    windowId,
    containerId,
    message,
    conversationHistory: history,
    systemPrompt: projectPrompt ?? globalPrompt ?? null,
    fireworksKey
  })
}

export function cancelWindow(windowId: number): void {
  const worker = workers.get(windowId)
  if (!worker) return
  worker.terminate()
  workers.delete(windowId)
}

export function resumeWindow(windowId: number, message: string): void {
  const worker = workers.get(windowId)
  if (!worker) return
  worker.postMessage({ type: 'resume', message })
}
```

- [ ] **Step 4: Run tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/assistedWindowService.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Add IPC handlers for assisted channels in ipcHandlers.ts**

Import and add handlers:
```typescript
import { sendToWindow, cancelWindow, resumeWindow } from './assistedWindowService'

// Inside handler registration:
ipcMain.handle('assisted:send', async (event, windowId: number, message: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  // get containerId and projectId from DB
  const row = getDb()
    .prepare('SELECT container_id, project_id FROM windows WHERE id = ?')
    .get(windowId) as { container_id: string; project_id: number | null } | undefined
  if (!row) throw new Error(`Window ${windowId} not found`)

  const sendToRenderer = (channel: string, ...args: unknown[]) => {
    win?.webContents.send(channel, ...args)
  }

  await sendToWindow(windowId, row.container_id, message, row.project_id, sendToRenderer)
})

ipcMain.handle('assisted:cancel', (_, windowId: number) => {
  cancelWindow(windowId)
})

ipcMain.handle('assisted:resume', (_, windowId: number, message: string) => {
  resumeWindow(windowId, message)
})

ipcMain.handle('assisted:history', (_, windowId: number) => {
  return getDb()
    .prepare('SELECT * FROM assisted_messages WHERE window_id = ? ORDER BY created_at ASC')
    .all(windowId)
})
```

- [ ] **Step 6: Add assisted IPC channels to preload/index.ts**

```typescript
  // Assisted window
  assistedSend: (windowId: number, message: string) =>
    ipcRenderer.invoke('assisted:send', windowId, message),
  assistedCancel: (windowId: number) => ipcRenderer.invoke('assisted:cancel', windowId),
  assistedResume: (windowId: number, message: string) =>
    ipcRenderer.invoke('assisted:resume', windowId, message),
  assistedHistory: (windowId: number) => ipcRenderer.invoke('assisted:history', windowId),
  onAssistedStreamChunk: (callback: (windowId: number, chunk: string) => void) =>
    ipcRenderer.on('assisted:stream-chunk', (_, windowId, chunk) => callback(windowId, chunk)),
  offAssistedStreamChunk: () => ipcRenderer.removeAllListeners('assisted:stream-chunk'),
  onAssistedKimiDelta: (callback: (windowId: number, delta: string) => void) =>
    ipcRenderer.on('assisted:kimi-delta', (_, windowId, delta) => callback(windowId, delta)),
  offAssistedKimiDelta: () => ipcRenderer.removeAllListeners('assisted:kimi-delta'),
  onAssistedPingUser: (callback: (windowId: number, message: string) => void) =>
    ipcRenderer.on('assisted:ping-user', (_, windowId, message) => callback(windowId, message)),
  offAssistedPingUser: () => ipcRenderer.removeAllListeners('assisted:ping-user'),
  onAssistedTurnComplete: (callback: (windowId: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => void) =>
    ipcRenderer.on('assisted:turn-complete', (_, windowId, stats, error) => callback(windowId, stats, error)),
  offAssistedTurnComplete: () => ipcRenderer.removeAllListeners('assisted:turn-complete'),
```

- [ ] **Step 7: Run all main tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/assistedWindowService.ts window-manager/src/main/ipcHandlers.ts window-manager/src/preload/index.ts window-manager/tests/main/assistedWindowService.test.ts
git commit -m "feat: add assistedWindowService worker management and IPC"
```

---

## Task 8: SettingsView.svelte — Fireworks API Key

**Files:**
- Modify: `window-manager/src/renderer/src/components/SettingsView.svelte`
- Modify: `window-manager/src/renderer/src/components/App.svelte` (if SettingsView props need updating — check if fireworksStatus is passed in)
- Test: `window-manager/tests/renderer/SettingsView.test.ts` (create)

- [ ] **Step 1: Write failing tests**

Create `window-manager/tests/renderer/SettingsView.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import SettingsView from '../../src/renderer/src/components/SettingsView.svelte'

const mockApi = {
  getGitHubPatStatus: vi.fn().mockResolvedValue({ configured: false, hint: null }),
  setGitHubPat: vi.fn(),
  clearGitHubPat: vi.fn(),
  getClaudeTokenStatus: vi.fn().mockResolvedValue({ configured: false, hint: null }),
  setClaudeToken: vi.fn(),
  clearClaudeToken: vi.fn(),
  getFireworksKeyStatus: vi.fn().mockResolvedValue({ configured: false, hint: null }),
  setFireworksKey: vi.fn().mockResolvedValue({ configured: true, hint: '5678' }),
  clearFireworksKey: vi.fn().mockResolvedValue({ configured: false, hint: null })
}

vi.stubGlobal('window', { api: mockApi })

const defaultProps = {
  patStatus: { configured: false, hint: null },
  claudeStatus: { configured: false, hint: null },
  fireworksStatus: { configured: false, hint: null },
  onPatStatusChange: vi.fn(),
  onClaudeStatusChange: vi.fn(),
  onFireworksStatusChange: vi.fn(),
  onCancel: vi.fn()
}

describe('Fireworks key section', () => {
  it('renders Fireworks API Key label', () => {
    render(SettingsView, defaultProps)
    expect(screen.getByText(/Fireworks API Key/i)).toBeTruthy()
  })

  it('shows Not configured status initially', () => {
    render(SettingsView, defaultProps)
    const sections = screen.getAllByText(/not configured/i)
    expect(sections.length).toBeGreaterThan(0)
  })

  it('save button calls setFireworksKey', async () => {
    const user = userEvent.setup()
    render(SettingsView, defaultProps)
    const input = screen.getByLabelText(/fireworks/i)
    await user.type(input, 'fw-my-key-5678')
    const saveBtn = screen.getByRole('button', { name: /save fireworks/i })
    await user.click(saveBtn)
    expect(mockApi.setFireworksKey).toHaveBeenCalledWith('fw-my-key-5678')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/SettingsView.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Update SettingsView.svelte Props and add fireworks section**

Update `Props` interface in `SettingsView.svelte`:
```typescript
interface Props {
  patStatus: TokenStatus
  claudeStatus: TokenStatus
  fireworksStatus: TokenStatus
  requiredFor?: SettingsRequirement
  onPatStatusChange: (status: TokenStatus) => void
  onClaudeStatusChange: (status: TokenStatus) => void
  onFireworksStatusChange: (status: TokenStatus) => void
  onCancel: () => void
}
```

Add state vars after `claudeError`:
```typescript
  let fireworksInput = $state('')
  let fireworksBusy = $state(false)
  let fireworksError = $state('')
```

Add functions after `clearClaude`:
```typescript
  async function saveFireworks(): Promise<void> {
    const trimmed = fireworksInput.trim()
    if (!trimmed || fireworksBusy) return
    fireworksBusy = true
    fireworksError = ''
    try {
      const next = await window.api.setFireworksKey(trimmed)
      fireworksInput = ''
      onFireworksStatusChange(next)
    } catch (err) {
      fireworksError = err instanceof Error ? err.message : String(err)
    } finally {
      fireworksBusy = false
    }
  }

  async function clearFireworks(): Promise<void> {
    if (fireworksBusy) return
    fireworksBusy = true
    fireworksError = ''
    try {
      const next = await window.api.clearFireworksKey()
      onFireworksStatusChange(next)
    } catch (err) {
      fireworksError = err instanceof Error ? err.message : String(err)
    } finally {
      fireworksBusy = false
    }
  }
```

Add section in template after the Claude token section (before the help paragraph):
```svelte
<section class="field">
  <label for="fireworks-key">Fireworks API Key</label>
  <div class="status-line">
    {#if fireworksStatus.configured}
      <span class="status configured">
        Configured{fireworksStatus.hint ? ` • ends in ${fireworksStatus.hint}` : ''}
      </span>
    {:else}
      <span class="status unconfigured">Not configured</span>
    {/if}
  </div>
  <input
    id="fireworks-key"
    type="password"
    autocomplete="off"
    placeholder={fireworksStatus.configured ? 'Enter a new key to replace' : 'fw-...'}
    bind:value={fireworksInput}
    disabled={fireworksBusy}
    onkeydown={(e) => { if (e.key === 'Enter') saveFireworks(); else if (e.key === 'Escape') onCancel() }}
  />
  <p class="help">Required for Assisted windows. Get one at fireworks.ai.</p>
  <div class="row-actions">
    {#if fireworksStatus.configured}
      <button type="button" class="clear" onclick={clearFireworks} disabled={fireworksBusy}>
        {fireworksBusy ? '…' : 'Clear'}
      </button>
    {/if}
    <button
      type="button"
      class="submit"
      onclick={saveFireworks}
      disabled={!fireworksInput.trim() || fireworksBusy}
    >
      {fireworksBusy ? 'Saving…' : 'Save Fireworks Key'}
    </button>
  </div>
  {#if fireworksError}
    <p class="error">{fireworksError}</p>
  {/if}
</section>
```

- [ ] **Step 4: Update App.svelte to pass fireworksStatus prop**

In `App.svelte`, add after `let claudeStatus`:
```typescript
  let fireworksStatus = $state<TokenStatus>({ configured: false, hint: null })
```

Update the `onMount` Promise.all (line ~25):
```typescript
  ;[patStatus, claudeStatus, fireworksStatus] = await Promise.all([
    window.api.getGitHubPatStatus(),
    window.api.getClaudeTokenStatus(),
    window.api.getFireworksKeyStatus()
  ])
```

Add handler after `handleClaudeStatusChange`:
```typescript
  function handleFireworksStatusChange(next: TokenStatus): void {
    fireworksStatus = next
  }
```

Update `<SettingsView>` usage (around line 246):
```svelte
  {patStatus}
  {claudeStatus}
  fireworksStatus={fireworksStatus}
  onPatStatusChange={handlePatStatusChange}
  onClaudeStatusChange={handleClaudeStatusChange}
  onFireworksStatusChange={handleFireworksStatusChange}
```

- [ ] **Step 5: Run tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/SettingsView.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/SettingsView.svelte window-manager/src/renderer/src/components/App.svelte window-manager/tests/renderer/SettingsView.test.ts
git commit -m "feat: add Fireworks API key section to SettingsView"
```

---

## Task 9: NewWindowWizard.svelte — Window Type Toggle

**Files:**
- Modify: `window-manager/src/renderer/src/components/NewWindowWizard.svelte`
- Test: extend `window-manager/tests/renderer/NewWindowWizard.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `window-manager/tests/renderer/NewWindowWizard.test.ts`:
```typescript
it('shows Manual and Assisted radio options', () => {
  render(NewWindowWizard, { project: mockProject, onCreated: vi.fn(), onCancel: vi.fn() })
  expect(screen.getByLabelText('Manual')).toBeTruthy()
  expect(screen.getByLabelText('Assisted')).toBeTruthy()
})

it('Assisted option disabled when no fireworks key configured', () => {
  // mock window.api.getFireworksKeyStatus returns { configured: false }
  render(NewWindowWizard, { project: mockProject, onCreated: vi.fn(), onCancel: vi.fn() })
  const assistedRadio = screen.getByLabelText('Assisted') as HTMLInputElement
  expect(assistedRadio.disabled).toBe(true)
})

it('passes assisted windowType to createWindow when Assisted selected', async () => {
  // mock getFireworksKeyStatus returns configured
  const createWindowMock = vi.fn().mockResolvedValue({ ...mockWindow, window_type: 'assisted' })
  window.api.createWindow = createWindowMock
  const user = userEvent.setup()
  render(NewWindowWizard, { project: mockProject, onCreated: vi.fn(), onCancel: vi.fn() })
  await user.click(screen.getByLabelText('Assisted'))
  await user.type(screen.getByPlaceholderText('dev-window'), 'my-window')
  await user.click(screen.getByRole('button', { name: /create window/i }))
  expect(createWindowMock).toHaveBeenCalledWith('my-window', [mockProject.id], false, {}, 'assisted')
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/NewWindowWizard.test.ts 2>&1 | tail -20
```
Expected: new tests fail.

- [ ] **Step 3: Update NewWindowWizard.svelte**

Add state:
```typescript
  let windowType = $state<'manual' | 'assisted'>('manual')
  let fireworksConfigured = $state(false)

  onMount(async () => {
    // existing onMount code...
    const fwStatus = await window.api.getFireworksKeyStatus()
    fireworksConfigured = fwStatus.configured
  })
```

Add type toggle section in template after the window name field:
```svelte
<div class="field">
  <span class="field-label">Type</span>
  <div class="type-toggle">
    <label class="type-option">
      <input type="radio" name="window-type" value="manual" bind:group={windowType} disabled={loading} />
      Manual
    </label>
    <label class="type-option" title={!fireworksConfigured ? 'Set Fireworks API key in Settings' : ''}>
      <input
        type="radio"
        name="window-type"
        value="assisted"
        bind:group={windowType}
        disabled={loading || !fireworksConfigured}
        aria-label="Assisted"
      />
      Assisted
    </label>
  </div>
</div>
```

Update `handleSubmit` to pass `windowType`:
```typescript
const record = await window.api.createWindow(trimmed, ids, withDeps, branchOverrides, windowType)
```

Add styles:
```css
  .type-toggle {
    display: flex;
    gap: 1rem;
  }
  .type-option {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    color: var(--fg-1);
    cursor: pointer;
    font-family: var(--font-ui);
    text-transform: none;
    letter-spacing: normal;
    font-weight: normal;
  }
  .type-option input { width: auto; cursor: pointer; }
```

- [ ] **Step 4: Run tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/NewWindowWizard.test.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/NewWindowWizard.svelte window-manager/tests/renderer/NewWindowWizard.test.ts
git commit -m "feat: add manual/assisted type toggle to NewWindowWizard"
```

---

## Task 10: AssistedPanel.svelte — Chat UI

**Files:**
- Create: `window-manager/src/renderer/src/components/AssistedPanel.svelte`
- Test: `window-manager/tests/renderer/AssistedPanel.test.ts`

- [ ] **Step 1: Write failing tests**

Create `window-manager/tests/renderer/AssistedPanel.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import AssistedPanel from '../../src/renderer/src/components/AssistedPanel.svelte'

const mockApi = {
  assistedHistory: vi.fn().mockResolvedValue([]),
  assistedSend: vi.fn().mockResolvedValue(undefined),
  assistedCancel: vi.fn().mockResolvedValue(undefined),
  assistedResume: vi.fn().mockResolvedValue(undefined),
  onAssistedStreamChunk: vi.fn(),
  offAssistedStreamChunk: vi.fn(),
  onAssistedKimiDelta: vi.fn(),
  offAssistedKimiDelta: vi.fn(),
  onAssistedPingUser: vi.fn(),
  offAssistedPingUser: vi.fn(),
  onAssistedTurnComplete: vi.fn(),
  offAssistedTurnComplete: vi.fn()
}
vi.stubGlobal('window', { api: mockApi })

const defaultProps = { windowId: 1, containerId: 'c1' }

describe('AssistedPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders chat input and send button', () => {
    render(AssistedPanel, defaultProps)
    expect(screen.getByPlaceholderText(/ask kimi/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /send/i })).toBeTruthy()
  })

  it('sends message on button click', async () => {
    const user = userEvent.setup()
    render(AssistedPanel, defaultProps)
    await user.type(screen.getByPlaceholderText(/ask kimi/i), 'build me a server')
    await user.click(screen.getByRole('button', { name: /send/i }))
    expect(mockApi.assistedSend).toHaveBeenCalledWith(1, 'build me a server')
  })

  it('shows cancel button while running', async () => {
    const user = userEvent.setup()
    render(AssistedPanel, defaultProps)
    await user.type(screen.getByPlaceholderText(/ask kimi/i), 'go')
    await user.click(screen.getByRole('button', { name: /send/i }))
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy()
  })

  it('shows token stats after turn complete', async () => {
    let turnCompleteCallback: ((wid: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => void) | null = null
    mockApi.onAssistedTurnComplete.mockImplementation((cb: typeof turnCompleteCallback) => { turnCompleteCallback = cb })
    render(AssistedPanel, defaultProps)
    turnCompleteCallback!(1, { inputTokens: 100, outputTokens: 50, costUsd: 0.001 })
    await waitFor(() => {
      expect(screen.getByText(/100/)).toBeTruthy()
    })
  })

  it('renders user messages right-aligned', async () => {
    mockApi.assistedHistory.mockResolvedValue([
      { id: 1, window_id: 1, role: 'user', content: 'hello', metadata: null, created_at: '' }
    ])
    render(AssistedPanel, defaultProps)
    await waitFor(() => {
      expect(screen.getByText('hello')).toBeTruthy()
    })
  })

  it('shows ping_user message as amber alert', async () => {
    let pingCallback: ((wid: number, msg: string) => void) | null = null
    mockApi.onAssistedPingUser.mockImplementation((cb: typeof pingCallback) => { pingCallback = cb })
    render(AssistedPanel, defaultProps)
    pingCallback!(1, 'Which database?')
    await waitFor(() => {
      expect(screen.getByText('Which database?')).toBeTruthy()
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/AssistedPanel.test.ts
```
Expected: FAIL — component not found.

- [ ] **Step 3: Create AssistedPanel.svelte**

Create `window-manager/src/renderer/src/components/AssistedPanel.svelte`:
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { AssistedMessage } from '../types'

  interface Props {
    windowId: number
    containerId: string
  }

  let { windowId, containerId }: Props = $props()

  interface DisplayMessage {
    id: number
    role: 'user' | 'assistant' | 'tool_result' | 'ping_user'
    content: string
    metadata: string | null
    streaming?: boolean
    expanded?: boolean
  }

  let messages = $state<DisplayMessage[]>([])
  let input = $state('')
  let running = $state(false)
  let cancelPending = $state(false)
  let lastStats = $state<{ inputTokens: number; outputTokens: number; costUsd: number } | null>(null)
  let pingActive = $state(false)

  onMount(async () => {
    const history = await window.api.assistedHistory(windowId)
    messages = history.map((m: AssistedMessage) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      metadata: m.metadata,
      expanded: false
    }))

    window.api.onAssistedStreamChunk((wid: number, chunk: string) => {
      if (wid !== windowId) return
      const last = messages[messages.length - 1]
      if (last?.role === 'tool_result' && last.streaming) {
        messages[messages.length - 1] = { ...last, content: last.content + chunk }
      } else {
        messages = [...messages, { id: Date.now(), role: 'tool_result', content: chunk, metadata: null, streaming: true, expanded: true }]
      }
    })

    window.api.onAssistedKimiDelta((wid: number, delta: string) => {
      if (wid !== windowId) return
      const last = messages[messages.length - 1]
      if (last?.role === 'assistant' && last.streaming) {
        messages[messages.length - 1] = { ...last, content: last.content + delta }
      } else {
        messages = [...messages, { id: Date.now(), role: 'assistant', content: delta, metadata: null, streaming: true }]
      }
    })

    window.api.onAssistedPingUser((wid: number, message: string) => {
      if (wid !== windowId) return
      messages = [...messages, { id: Date.now(), role: 'ping_user', content: message, metadata: null }]
      pingActive = true
    })

    window.api.onAssistedTurnComplete((wid: number, stats: { inputTokens: number; outputTokens: number; costUsd: number } | null, error?: string) => {
      if (wid !== windowId) return
      running = false
      pingActive = false
      lastStats = stats
      // finalize any streaming messages
      messages = messages.map(m => ({ ...m, streaming: false }))
      if (error) {
        messages = [...messages, { id: Date.now(), role: 'assistant', content: `Error: ${error}`, metadata: JSON.stringify({ error: true }) }]
      }
    })
  })

  onDestroy(() => {
    window.api.offAssistedStreamChunk()
    window.api.offAssistedKimiDelta()
    window.api.offAssistedPingUser()
    window.api.offAssistedTurnComplete()
  })

  async function send(): Promise<void> {
    const trimmed = input.trim()
    if (!trimmed || running) return
    input = ''
    running = true
    lastStats = null
    messages = [...messages, { id: Date.now(), role: 'user', content: trimmed, metadata: null }]
    await window.api.assistedSend(windowId, trimmed)
  }

  async function handleCancel(): Promise<void> {
    if (!confirm('Cancel current run? Conversation will be preserved.')) return
    await window.api.assistedCancel(windowId)
    running = false
    pingActive = false
    messages = messages.map(m => ({ ...m, streaming: false }))
  }

  async function handlePingReply(): Promise<void> {
    const trimmed = input.trim()
    if (!trimmed) return
    input = ''
    pingActive = false
    messages = [...messages, { id: Date.now(), role: 'user', content: trimmed, metadata: null }]
    await window.api.assistedResume(windowId, trimmed)
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (pingActive) handlePingReply()
      else send()
    }
  }

  function toggleExpand(id: number): void {
    messages = messages.map(m => m.id === id ? { ...m, expanded: !m.expanded } : m)
  }
</script>

<div class="assisted-panel">
  <div class="messages">
    {#each messages as msg (msg.id)}
      {#if msg.role === 'user'}
        <div class="msg user">{msg.content}</div>
      {:else if msg.role === 'assistant'}
        <div class="msg assistant">{msg.content}</div>
      {:else if msg.role === 'tool_result'}
        <div class="msg tool-result">
          <button class="expand-toggle" onclick={() => toggleExpand(msg.id)} type="button">
            {msg.expanded ? '▾' : '▸'} Claude Code output {msg.streaming ? '(running…)' : ''}
          </button>
          {#if msg.expanded}
            <pre class="tool-output">{msg.content}</pre>
          {/if}
        </div>
      {:else if msg.role === 'ping_user'}
        <div class="msg ping-user" role="alert">{msg.content}</div>
      {/if}
    {/each}
  </div>

  {#if lastStats}
    <div class="stats-bar">
      ↑ {lastStats.inputTokens.toLocaleString()} tokens
      ↓ {lastStats.outputTokens.toLocaleString()} tokens
      ~${lastStats.costUsd.toFixed(4)}
    </div>
  {/if}

  <div class="input-row">
    <textarea
      placeholder={pingActive ? 'Reply to Kimi…' : 'Ask Kimi…'}
      bind:value={input}
      disabled={running && !pingActive}
      onkeydown={handleKey}
      rows={2}
    ></textarea>
    <div class="input-actions">
      {#if running && !pingActive}
        <button type="button" class="cancel-btn" onclick={handleCancel} aria-label="Cancel">Cancel</button>
      {:else}
        <button type="button" class="send-btn" onclick={pingActive ? handlePingReply : send} disabled={!input.trim()} aria-label="Send">
          Send
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .assisted-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-0);
    overflow: hidden;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .msg {
    max-width: 85%;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.85rem;
    line-height: 1.5;
    word-break: break-word;
  }

  .msg.user {
    align-self: flex-end;
    background: var(--accent);
    color: white;
  }

  .msg.assistant {
    align-self: flex-start;
    background: var(--bg-1);
    border: 1px solid var(--border);
    color: var(--fg-0);
  }

  .msg.tool-result {
    align-self: stretch;
    background: var(--bg-1);
    border: 1px solid var(--border);
    max-width: 100%;
  }

  .msg.ping-user {
    align-self: stretch;
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgb(245, 158, 11);
    color: var(--fg-0);
    max-width: 100%;
  }

  .expand-toggle {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.78rem;
    color: var(--fg-2);
    padding: 0;
    text-align: left;
    width: 100%;
  }

  .expand-toggle:hover { color: var(--fg-0); }

  .tool-output {
    margin: 0.5rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 400px;
    overflow-y: auto;
  }

  .stats-bar {
    padding: 0.3rem 0.75rem;
    font-size: 0.72rem;
    color: var(--fg-2);
    border-top: 1px solid var(--border);
    font-family: var(--font-mono);
  }

  .input-row {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--border);
  }

  textarea {
    flex: 1;
    resize: none;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.4rem 0.6rem;
    outline: none;
  }

  textarea:focus { border-color: var(--accent); }
  textarea:disabled { opacity: 0.5; }

  .input-actions {
    display: flex;
    align-items: flex-end;
  }

  .send-btn, .cancel-btn {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.4rem 0.8rem;
    border-radius: 4px;
    border: 1px solid;
    cursor: pointer;
  }

  .send-btn {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .send-btn:hover:not(:disabled) {
    background: var(--accent-hi);
    border-color: var(--accent-hi);
  }

  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .cancel-btn {
    background: transparent;
    border-color: var(--danger);
    color: var(--danger);
  }

  .cancel-btn:hover {
    background: var(--danger);
    color: white;
  }
</style>
```

- [ ] **Step 4: Run tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/AssistedPanel.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/AssistedPanel.svelte window-manager/tests/renderer/AssistedPanel.test.ts
git commit -m "feat: add AssistedPanel chat UI component"
```

---

## Task 11: TerminalHost.svelte + WindowDetailPane.svelte — Conditional Rendering

**Files:**
- Modify: `window-manager/src/renderer/src/components/TerminalHost.svelte`
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`
- Test: extend `window-manager/tests/renderer/TerminalHost.test.ts`
- Test: extend `window-manager/tests/renderer/WindowDetailPane.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `window-manager/tests/renderer/TerminalHost.test.ts`:
```typescript
it('renders AssistedPanel instead of Claude xterm for assisted windows', () => {
  const assistedWin = { ...mockWin, window_type: 'assisted' as const }
  render(TerminalHost, { win: assistedWin, project: mockProject })
  // AssistedPanel renders a textarea, Claude panel renders a div.terminal-inner
  expect(screen.queryByPlaceholderText(/ask kimi/i)).toBeTruthy()
  expect(document.querySelector('.terminal-inner')).toBeNull()
})
```

Add to `window-manager/tests/renderer/WindowDetailPane.test.ts`:
```typescript
it('hides Claude toggle button for assisted windows', () => {
  const assistedWin = { ...mockWin, window_type: 'assisted' as const }
  render(WindowDetailPane, { ...defaultProps, win: assistedWin })
  expect(screen.queryByRole('button', { name: /claude/i })).toBeNull()
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/TerminalHost.test.ts tests/renderer/WindowDetailPane.test.ts 2>&1 | tail -20
```
Expected: new tests fail.

- [ ] **Step 3: Update TerminalHost.svelte**

Import `AssistedPanel`:
```typescript
import AssistedPanel from './AssistedPanel.svelte'
```

In the template, find the section that renders the `claude` panel content (the xterm div). Wrap it with a conditional:
```svelte
{#if panel.id === 'claude'}
  {#if win.window_type === 'assisted'}
    <AssistedPanel windowId={win.id} containerId={win.container_id} />
  {:else}
    <div class="terminal-inner" bind:this={claudeEl}></div>
  {/if}
{/if}
```

Also guard the `onMount` claude terminal open: only open claude terminal session when `win.window_type === 'manual'`:
```typescript
onMount(async () => {
  if (win.window_type === 'manual') {
    await window.api.openTerminal(win.container_id, 80, 24, win.name, 'claude')
    // ... existing code
  }
})
```

- [ ] **Step 4: Update WindowDetailPane.svelte**

Find the Claude toggle button in the toggle row. Wrap with a conditional:
```svelte
{#if win.window_type !== 'assisted'}
  <button
    aria-pressed={panelVisible.claude}
    aria-label="Claude"
    disabled={panelVisible.claude && visibleCount === 1}
    onclick={() => togglePanel('claude')}
  >Claude</button>
{/if}
```

- [ ] **Step 5: Run all renderer tests**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/
```
Expected: all pass.

- [ ] **Step 6: Run full test suite**

```bash
cd /workspace/claude-window/window-manager && npx vitest run
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/TerminalHost.svelte window-manager/src/renderer/src/components/WindowDetailPane.svelte window-manager/tests/renderer/TerminalHost.test.ts window-manager/tests/renderer/WindowDetailPane.test.ts
git commit -m "feat: wire AssistedPanel into TerminalHost, hide Claude toggle for assisted windows"
```

---

## Spec Coverage Check

| Spec Section | Covered By |
|---|---|
| DB: `window_type` on windows | Task 1 |
| DB: `kimi_system_prompt` on projects | Task 1 |
| DB: `assisted_messages` table | Task 1 |
| DB: `fireworks_api_key` in settings | Task 4 |
| DB: `kimi_system_prompt` in settings | Task 4 |
| Container image: `cw-claude-sdk.js` + Dockerfile | Task 3 |
| Fireworks key: get/set/clear/status backend | Task 4 |
| Kimi system prompt: global get/set | Task 4 |
| Kimi system prompt: per-project set | Task 4 |
| Worker architecture: `assistedWindowWorker.ts` | Task 6 |
| Worker architecture: `assistedWindowService.ts` | Task 7 |
| IPC channels: all `assisted:*` | Task 7 |
| IPC channels: `settings:*-fireworks-key` | Task 4 |
| Kimi tools: `run_claude_code` + `ping_user` | Task 6 |
| System prompt resolution order | Task 6 |
| Token/cost stats | Task 6 |
| Fireworks key: Settings UI | Task 8 |
| Window creation: type toggle | Task 9 |
| Window creation: Fireworks key guard | Task 5 |
| `AssistedPanel.svelte` full UI | Task 10 |
| Cancel with confirmation | Task 10 |
| Streaming Claude output | Task 10 |
| `ping_user` amber alert in chat | Task 10 |
| TerminalHost conditional render | Task 11 |
| WindowDetailPane hide Claude toggle | Task 11 |
| Error handling (worker crash, API fail) | Task 7 |
| `window_type` in `WindowRecord` type | Task 2 |
