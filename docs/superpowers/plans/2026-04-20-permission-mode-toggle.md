# Permission Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-window in-memory Bypass/Plan toggle to AssistedPanel that threads `permissionMode` through the full stack to `cw-claude-sdk.js` as a CLI arg.

**Architecture:** `PermissionMode` type defined in `src/shared/permissionMode.ts`. Threaded as a new parameter through `claudeService` → `claudeDirectWorker` → `claudeRunner` → docker exec arg. UI is a radio pair in `AssistedPanel` alongside the existing recipient toggle, visible only when `currentRecipient === 'claude'`.

**Tech Stack:** TypeScript, Svelte 5 runes, Electron IPC, Vitest, @testing-library/svelte

---

### Task 1: Add `PermissionMode` shared type

**Files:**
- Create: `window-manager/src/shared/permissionMode.ts`

- [ ] **Step 1: Write the file**

```typescript
// Shared type for Claude SDK permissionMode option.
// 'bypassPermissions' — no permission prompts (default)
// 'plan'             — Claude shows a plan and waits for approval before executing
export type PermissionMode = 'bypassPermissions' | 'plan'
```

- [ ] **Step 2: Commit**

```bash
git add window-manager/src/shared/permissionMode.ts
git commit -m "feat: add PermissionMode shared type"
```

---

### Task 2: Update `cw-claude-sdk.js` to accept `--mode` arg

**Files:**
- Modify: `files/cw-claude-sdk.js`

- [ ] **Step 1: Write the failing test**

There is no automated test for `cw-claude-sdk.js` (it runs inside Docker). Verify manually after the full stack is wired. Skip to Step 2.

- [ ] **Step 2: Update the file**

Replace the `options` block (lines 33–37):

```javascript
  const rawMode = process.argv[4]
  const permissionMode = (rawMode === 'plan') ? 'plan' : 'bypassPermissions'

  const options = {
    permissionMode,
    includePartialMessages: true,
    ...(sessionId ? { resume: sessionId } : {})
  }
```

The full updated `main()` function reads:
- `process.argv[2]` → sessionId (unchanged)
- `process.argv[3]` → message (unchanged, joined from `slice(3)` — **NOTE:** this means the message arg consumes `argv[3]` onward when called with multiple words; the mode must be a separate arg passed before the message, or after via a flag)

**Important:** The current call in `claudeRunner.ts` is:
```javascript
spawn('docker', ['exec', containerId, 'node', '/usr/local/bin/cw-claude-sdk.js', sidArg, message])
```
`argv[2]` = sidArg, `argv[3]` = message (single string). The new call will be:
```javascript
spawn('docker', ['exec', containerId, 'node', '/usr/local/bin/cw-claude-sdk.js', sidArg, message, permissionMode])
```
`argv[2]` = sidArg, `argv[3]` = message, `argv[4]` = permissionMode.

So in `cw-claude-sdk.js`, change `message` to read only `process.argv[3]` (not `slice(3).join(' ')`), and read mode from `process.argv[4]`:

```javascript
  const rawSessionId = process.argv[2]
  const sessionId = (!rawSessionId || rawSessionId === 'new') ? undefined : rawSessionId
  const message = process.argv[3]
  const rawMode = process.argv[4]
  const permissionMode = (rawMode === 'plan') ? 'plan' : 'bypassPermissions'

  if (!message) {
    process.stderr.write('ERROR: no message provided\n')
    process.exit(1)
  }
```

And update `options`:
```javascript
  const options = {
    permissionMode,
    includePartialMessages: true,
    ...(sessionId ? { resume: sessionId } : {})
  }
```

- [ ] **Step 3: Commit**

```bash
git add files/cw-claude-sdk.js
git commit -m "feat: cw-claude-sdk accepts permissionMode as argv[4]"
```

---

### Task 3: Update `claudeRunner.ts` to accept and pass `permissionMode`

**Files:**
- Modify: `window-manager/src/main/claudeRunner.ts`
- Modify: `window-manager/tests/main/claudeRunner.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `window-manager/tests/main/claudeRunner.test.ts` inside the `describe('runClaudeCode')` block:

```typescript
  it('passes permissionMode=plan to docker exec args', async () => {
    const { child, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = runClaudeCode('c1', null, 'msg', { permissionMode: 'plan' })
    close(0)
    await promise
    expect(mockSpawn).toHaveBeenCalledWith('docker', [
      'exec', 'c1', 'node', '/usr/local/bin/cw-claude-sdk.js', 'new', 'msg', 'plan'
    ])
  })

  it('passes permissionMode=bypassPermissions by default', async () => {
    const { child, close } = makeFakeChild()
    mockSpawn.mockReturnValue(child)
    const promise = runClaudeCode('c1', null, 'msg')
    close(0)
    await promise
    expect(mockSpawn).toHaveBeenCalledWith('docker', [
      'exec', 'c1', 'node', '/usr/local/bin/cw-claude-sdk.js', 'new', 'msg', 'bypassPermissions'
    ])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/claudeRunner.test.ts
```

Expected: 2 new tests FAIL (wrong arg count in spawn call).

- [ ] **Step 3: Update `claudeRunner.ts`**

Change the `options` parameter type and spawn call:

```typescript
import type { PermissionMode } from '../shared/permissionMode'

export async function runClaudeCode(
  containerId: string,
  sessionId: string | null,
  message: string,
  options: { eventType?: string; permissionMode?: PermissionMode } = {}
): Promise<{ output: string; assistantText: string; events: TimelineEvent[]; newSessionId: string | null }> {
  const eventType = options.eventType ?? 'claude:event'
  const permissionMode = options.permissionMode ?? 'bypassPermissions'
  return new Promise((resolve, reject) => {
    const sidArg = sessionId ?? 'new'
    const child = spawn('docker', [
      'exec', containerId, 'node', '/usr/local/bin/cw-claude-sdk.js',
      sidArg, message, permissionMode
    ])
    // ... rest unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/claudeRunner.test.ts
```

Expected: all tests PASS (including the 2 new ones and the existing `passes new session arg` test — update that test's expected args to include the default mode arg).

> **Note:** The existing test `'passes new session arg when sessionId is null'` currently expects:
> ```
> ['exec', 'c1', 'node', '/usr/local/bin/cw-claude-sdk.js', 'new', 'msg']
> ```
> Update it to:
> ```
> ['exec', 'c1', 'node', '/usr/local/bin/cw-claude-sdk.js', 'new', 'msg', 'bypassPermissions']
> ```

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/claudeRunner.ts window-manager/tests/main/claudeRunner.test.ts
git commit -m "feat: claudeRunner threads permissionMode to docker exec"
```

---

### Task 4: Update `claudeDirectWorker.ts` to thread `permissionMode`

**Files:**
- Modify: `window-manager/src/main/claudeDirectWorker.ts`
- Modify: `window-manager/tests/main/claudeDirectWorker.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `window-manager/tests/main/claudeDirectWorker.test.ts` inside `describe('claudeDirectWorker')`:

```typescript
  it('forwards permissionMode to runClaudeCode', async () => {
    await messageHandler?.({
      type: 'send',
      windowId: 7,
      containerId: 'c7',
      message: 'hi',
      initialSessionId: null,
      permissionMode: 'plan'
    })
    expect(mockRunClaudeCode).toHaveBeenCalledWith('c7', null, 'hi', { permissionMode: 'plan' })
  })

  it('defaults permissionMode to bypassPermissions when not provided', async () => {
    await messageHandler?.({
      type: 'send',
      windowId: 8,
      containerId: 'c8',
      message: 'hi',
      initialSessionId: null
    })
    expect(mockRunClaudeCode).toHaveBeenCalledWith('c8', null, 'hi', { permissionMode: 'bypassPermissions' })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/claudeDirectWorker.test.ts
```

Expected: 2 new tests FAIL.

- [ ] **Step 3: Update `claudeDirectWorker.ts`**

```typescript
import { parentPort } from 'worker_threads'
import type { TimelineEvent } from '../shared/timelineEvent'
import type { PermissionMode } from '../shared/permissionMode'
import { runClaudeCode } from './claudeRunner'

type DirectSendMsg = {
  type: 'send'
  windowId: number
  containerId: string
  message: string
  initialSessionId: string | null
  permissionMode?: PermissionMode
}

parentPort?.on('message', async (msg: { type: string } & Record<string, unknown>) => {
  if (msg.type !== 'send') return
  const { windowId, containerId, message, initialSessionId, permissionMode } = msg as unknown as DirectSendMsg

  try {
    const { output, assistantText, newSessionId, events } = await runClaudeCode(
      containerId,
      initialSessionId,
      message,
      { permissionMode: permissionMode ?? 'bypassPermissions' }
    )
    // ... rest of handler unchanged
```

Also update the existing test for `'calls runClaudeCode with correct args on send message'` — it currently expects `runClaudeCode('c1', null, 'hi')` (3 args). Update to:
```typescript
expect(mockRunClaudeCode).toHaveBeenCalledWith('c1', null, 'hi', { permissionMode: 'bypassPermissions' })
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/claudeDirectWorker.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/claudeDirectWorker.ts window-manager/tests/main/claudeDirectWorker.test.ts
git commit -m "feat: claudeDirectWorker threads permissionMode to runClaudeCode"
```

---

### Task 5: Update `claudeService.ts` to accept and thread `permissionMode`

**Files:**
- Modify: `window-manager/src/main/claudeService.ts`
- Modify: `window-manager/tests/main/claudeService.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `window-manager/tests/main/claudeService.test.ts` inside `describe('sendToClaudeDirectly')`:

```typescript
  it('posts permissionMode in worker send message', async () => {
    await sendToClaudeDirectly(5, 'c5', 'do it', vi.fn(), 'plan')
    expect(mockWorkerPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'send', permissionMode: 'plan' })
    )
  })

  it('defaults permissionMode to bypassPermissions', async () => {
    await sendToClaudeDirectly(6, 'c6', 'do it', vi.fn())
    expect(mockWorkerPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'send', permissionMode: 'bypassPermissions' })
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/claudeService.test.ts
```

Expected: 2 new tests FAIL.

- [ ] **Step 3: Update `claudeService.ts`**

Add import and update the function signature and worker postMessage call:

```typescript
import type { PermissionMode } from '../shared/permissionMode'

export async function sendToClaudeDirectly(
  windowId: number,
  containerId: string,
  message: string,
  sendToRenderer: (channel: string, ...args: unknown[]) => void,
  permissionMode: PermissionMode = 'bypassPermissions'
): Promise<void> {
  saveMessage(windowId, 'user', message, null)
  const initialSessionId = loadLastSessionId(windowId)

  // ... worker setup unchanged ...

  worker.postMessage({ type: 'send', windowId, containerId, message, initialSessionId, permissionMode })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/claudeService.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add window-manager/src/main/claudeService.ts window-manager/tests/main/claudeService.test.ts
git commit -m "feat: claudeService accepts and threads permissionMode"
```

---

### Task 6: Update `ipcHandlers.ts` to extract `permissionMode` from `claude:send`

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`

No new test needed for this layer (it is an integration glue layer; the surrounding layers have unit tests). The change is a one-liner.

- [ ] **Step 1: Update the `claude:send` handler**

Locate the handler (around line 371) and update:

```typescript
  ipcMain.handle('claude:send', async (event, windowId: number, message: string, permissionMode?: PermissionMode) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const row = getDb()
      .prepare('SELECT container_id FROM windows WHERE id = ?')
      .get(windowId) as { container_id: string } | undefined
    if (!row) throw new Error(`Window ${windowId} not found`)

    const sendToRenderer = (channel: string, ...args: unknown[]) => {
      win?.webContents.send(channel, ...args)
    }

    await sendToClaudeDirectly(windowId, row.container_id, message, sendToRenderer, permissionMode)
  })
```

Add the import at the top of the file:
```typescript
import type { PermissionMode } from '../shared/permissionMode'
```

- [ ] **Step 2: Run all main tests to verify no regressions**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add window-manager/src/main/ipcHandlers.ts
git commit -m "feat: ipcHandlers passes permissionMode through claude:send"
```

---

### Task 7: Update `preload/index.ts` to add `permissionMode` to `claudeSend`

**Files:**
- Modify: `window-manager/src/preload/index.ts`
- Modify: `window-manager/src/preload/index.d.ts` (if it exists and types `claudeSend`)

- [ ] **Step 1: Update `claudeSend` in `preload/index.ts`**

Find the `claudeSend` line (around line 173) and update:

```typescript
  claudeSend: (windowId: number, message: string, permissionMode?: 'bypassPermissions' | 'plan') =>
    ipcRenderer.invoke('claude:send', windowId, message, permissionMode),
```

- [ ] **Step 2: Check `index.d.ts` and update if needed**

```bash
grep -n "claudeSend" /workspace/claude-window/window-manager/src/preload/index.d.ts 2>/dev/null || echo "not in d.ts"
```

If `claudeSend` appears in `index.d.ts`, update its signature to match:
```typescript
claudeSend: (windowId: number, message: string, permissionMode?: 'bypassPermissions' | 'plan') => Promise<void>
```

- [ ] **Step 3: Run all main tests to verify no regressions**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/main/
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add window-manager/src/preload/index.ts window-manager/src/preload/index.d.ts
git commit -m "feat: preload exposes permissionMode param on claudeSend"
```

---

### Task 8: Update `AssistedPanel.svelte` — add toggle UI and pass `permissionMode`

**Files:**
- Modify: `window-manager/src/renderer/src/components/AssistedPanel.svelte`
- Modify: `window-manager/tests/renderer/AssistedPanel.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `window-manager/tests/renderer/AssistedPanel.test.ts`:

```typescript
  it('renders Bypass/Plan toggle when recipient is Claude', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    expect(screen.getByRole('radio', { name: /bypass/i })).toBeDefined()
    expect(screen.getByRole('radio', { name: /plan/i })).toBeDefined()
  })

  it('hides Bypass/Plan toggle when recipient is Shellephant', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const shellephantRadio = screen.getByRole('radio', { name: /shellephant/i })
    await fireEvent.click(shellephantRadio)
    expect(screen.queryByRole('radio', { name: /bypass/i })).toBeNull()
    expect(screen.queryByRole('radio', { name: /plan/i })).toBeNull()
  })

  it('calls claudeSend with bypassPermissions by default', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const textarea = screen.getByRole('textbox')
    await fireEvent.input(textarea, { target: { value: 'hello' } })
    await fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(mockApi.claudeSend).toHaveBeenCalledWith(1, 'hello', 'bypassPermissions'))
  })

  it('calls claudeSend with plan when Plan mode selected', async () => {
    render(AssistedPanel, defaultProps)
    await waitFor(() => expect(mockApi.assistedHistory).toHaveBeenCalled())
    const planRadio = screen.getByRole('radio', { name: /plan/i })
    await fireEvent.click(planRadio)
    const textarea = screen.getByRole('textbox')
    await fireEvent.input(textarea, { target: { value: 'do something' } })
    await fireEvent.keyDown(textarea, { key: 'Enter' })
    await waitFor(() => expect(mockApi.claudeSend).toHaveBeenCalledWith(1, 'do something', 'plan'))
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/AssistedPanel.test.ts
```

Expected: 4 new tests FAIL.

- [ ] **Step 3: Add `permissionMode` state and toggle UI to `AssistedPanel.svelte`**

In the `<script>` block, after the `currentRecipient` state declaration, add:

```typescript
  type PermissionMode = 'bypassPermissions' | 'plan'
  let permissionMode = $state<PermissionMode>('bypassPermissions')
```

In the `send()` function, update the `claudeSend` call:

```typescript
  async function send(): Promise<void> {
    const trimmed = input.trim()
    if (!trimmed || running) return
    input = ''
    running = true
    lastStats = null
    messages = [...messages, { id: nextId(), role: 'user', content: trimmed, metadata: null }]
    if (currentRecipient === 'claude') {
      await window.api.claudeSend(windowId, trimmed, permissionMode)
    } else {
      await window.api.assistedSend(windowId, trimmed)
    }
  }
```

In the template, update the `.recipient-toggle` div to add the mode toggle alongside, visible only when `currentRecipient === 'claude'`:

```html
  <div class="recipient-toggle">
    <label>
      <input type="radio" name="recipient-{windowId}" value="claude" bind:group={currentRecipient} />
      Claude
    </label>
    <label title={!fireworksConfigured ? 'Set Fireworks API key in Settings' : ''}>
      <input
        type="radio"
        name="recipient-{windowId}"
        value="shellephant"
        disabled={!fireworksConfigured}
        bind:group={currentRecipient}
      />
      Shellephant
    </label>
    {#if currentRecipient === 'claude'}
      <span class="mode-divider">|</span>
      <label>
        <input type="radio" name="permission-mode-{windowId}" value="bypassPermissions" bind:group={permissionMode} />
        Bypass
      </label>
      <label>
        <input type="radio" name="permission-mode-{windowId}" value="plan" bind:group={permissionMode} />
        Plan
      </label>
    {/if}
  </div>
```

Add CSS for `.mode-divider` in the `<style>` block:

```css
  .mode-divider {
    color: var(--border);
    user-select: none;
    padding: 0 0.25rem;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /workspace/claude-window/window-manager && npx vitest run tests/renderer/AssistedPanel.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
cd /workspace/claude-window/window-manager && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add window-manager/src/renderer/src/components/AssistedPanel.svelte window-manager/tests/renderer/AssistedPanel.test.ts
git commit -m "feat: AssistedPanel permission mode toggle (Bypass/Plan)"
```

---

## Self-Review

**Spec coverage:**
- ✅ `PermissionMode` type defined → Task 1
- ✅ `cw-claude-sdk.js` reads mode from argv → Task 2
- ✅ `claudeRunner.ts` passes mode as CLI arg → Task 3
- ✅ `claudeDirectWorker.ts` threads mode → Task 4
- ✅ `claudeService.ts` threads mode → Task 5
- ✅ `ipcHandlers.ts` extracts and threads mode → Task 6
- ✅ `preload/index.ts` exposes mode param → Task 7
- ✅ `AssistedPanel.svelte` toggle UI + passes on send → Task 8
- ✅ Toggle hidden when `currentRecipient === 'shellephant'` → Task 8 tests
- ✅ Default `bypassPermissions` at every layer → Tasks 3–8
- ✅ In-memory only, no DB changes → no DB task needed

**Placeholder scan:** None found.

**Type consistency:** `PermissionMode` imported from `../shared/permissionMode` in Tasks 3–6. Preload and Svelte use inline union literal (no import path issue across compile boundaries). Consistent.
