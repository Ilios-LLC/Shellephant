# Phone Access Web Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed a lightweight HTTP + WebSocket server in the Electron main process so Claude PTY sessions can be viewed and interacted with from a phone browser over Tailscale.

**Architecture:** A new `phoneServer.ts` module manages server lifecycle; `phoneServerHtml.ts` holds the inline phone UI (xterm.js via CDN, window list + terminal view). Three IPC handlers expose start/stop/status to the renderer. `WindowDetailPane.svelte` gets a "Phone" toggle button.

**Tech Stack:** Node.js `http`, `ws` npm package, `os` (Tailscale IP detection), xterm.js 5.3.0 + xterm-addon-fit 0.8.0 (CDN), Svelte 5 runes, Vitest

---

## Files

| Action | Path |
|--------|------|
| Create | `window-manager/src/main/phoneServerHtml.ts` |
| Create | `window-manager/src/main/phoneServer.ts` |
| Create | `window-manager/tests/main/phoneServer.test.ts` |
| Modify | `window-manager/src/main/ipcHandlers.ts` |
| Modify | `window-manager/src/preload/index.ts` |
| Modify | `window-manager/src/renderer/src/components/WindowDetailPane.svelte` |

---

### Task 1: Install ws package

**Files:**
- Modify: `window-manager/package.json`

- [ ] **Step 1: Install ws**

```bash
cd /workspace/claude-window/window-manager && npm install ws
```

`ws` v8+ ships bundled TypeScript types — no `@types/ws` needed.

- [ ] **Step 2: Verify**

```bash
grep '"ws"' /workspace/claude-window/window-manager/package.json
```

Expected: line like `"ws": "^8.x.x"` in `dependencies`.

- [ ] **Step 3: Commit**

```bash
cd /workspace/claude-window && git add window-manager/package.json window-manager/package-lock.json
git commit -m "chore: add ws package for phone server"
```

---

### Task 2: Create phoneServerHtml.ts (TDD)

**Files:**
- Create: `window-manager/tests/main/phoneServer.test.ts`
- Create: `window-manager/src/main/phoneServerHtml.ts`

- [ ] **Step 1: Write failing tests**

Create `window-manager/tests/main/phoneServer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getPhoneServerHtml } from '../../src/main/phoneServerHtml'

describe('getPhoneServerHtml', () => {
  it('returns HTML containing xterm script tag', () => {
    expect(getPhoneServerHtml()).toContain('xterm')
  })

  it('returns HTML containing WebSocket connection code', () => {
    expect(getPhoneServerHtml()).toContain('WebSocket')
  })

  it('returns HTML containing /api/windows fetch', () => {
    expect(getPhoneServerHtml()).toContain('/api/windows')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /workspace/claude-window && npx vitest run --project main tests/main/phoneServer.test.ts
```

Expected: FAIL — `Cannot find module '../../src/main/phoneServerHtml'`

- [ ] **Step 3: Create phoneServerHtml.ts**

Create `window-manager/src/main/phoneServerHtml.ts`:

```typescript
export function getPhoneServerHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Claude Windows</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1a1a1a; color: #e0e0e0; font-family: system-ui, sans-serif; }
    #list-view { padding: 1rem; }
    h1 { font-size: 1.2rem; margin-bottom: 0.75rem; color: #ccc; }
    .window-card { background: #2a2a2a; border-radius: 6px; padding: 0.85rem 1rem; margin-bottom: 0.6rem; cursor: pointer; border: 1px solid #333; }
    .window-name { font-size: 1rem; font-weight: 600; }
    .window-status { font-size: 0.8rem; color: #888; margin-top: 0.2rem; }
    #terminal-view { display: none; flex-direction: column; height: 100dvh; }
    #terminal-view.active { display: flex; }
    #terminal-header { padding: 0.4rem 0.75rem; background: #2a2a2a; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0; }
    #back-btn { background: none; border: 1px solid #555; color: #ccc; padding: 0.2rem 0.6rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
    #terminal-title { font-size: 0.9rem; color: #ccc; }
    #terminal-container { flex: 1; min-height: 0; }
    .xterm { height: 100%; }
    .xterm-viewport { overflow-y: scroll !important; }
  </style>
</head>
<body>
  <div id="list-view">
    <h1>Claude Windows</h1>
    <div id="window-list"><p style="color:#888">Loading\u2026</p></div>
  </div>
  <div id="terminal-view">
    <div id="terminal-header">
      <button id="back-btn" onclick="showList()">&#8592; Back</button>
      <span id="terminal-title"></span>
    </div>
    <div id="terminal-container"></div>
  </div>
  <script>
    var term = null, fitAddon = null, ws = null;

    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    async function showList() {
      if (ws) { ws.close(); ws = null; }
      if (term) { term.dispose(); term = null; }
      document.getElementById('list-view').style.display = 'block';
      document.getElementById('terminal-view').classList.remove('active');
      var res = await fetch('/api/windows');
      var windows = await res.json();
      var list = document.getElementById('window-list');
      list.innerHTML = '';
      if (windows.length === 0) {
        list.innerHTML = '<p style="color:#888">No active windows.</p>';
        return;
      }
      windows.forEach(function(w) {
        var card = document.createElement('div');
        card.className = 'window-card';
        card.innerHTML = '<div class="window-name">' + escHtml(w.name) + '</div><div class="window-status">' + escHtml(w.status) + '</div>';
        card.onclick = function() { openTerminal(w.container_id, w.name); };
        list.appendChild(card);
      });
    }

    function openTerminal(containerId, name) {
      document.getElementById('list-view').style.display = 'none';
      document.getElementById('terminal-view').classList.add('active');
      document.getElementById('terminal-title').textContent = name;
      term = new Terminal({ theme: { background: '#1a1a1a' }, scrollback: 5000, fontFamily: 'monospace' });
      fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal-container'));
      requestAnimationFrame(function() { fitAddon.fit(); });
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(proto + '//' + location.host + '/ws/' + containerId);
      ws.binaryType = 'arraybuffer';
      ws.onmessage = function(e) {
        term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
      };
      ws.onclose = function() { term.write('\\r\\n[disconnected]\\r\\n'); };
      term.onData(function(d) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(d); });
      window.addEventListener('resize', function() { if (fitAddon) fitAddon.fit(); });
    }

    showList();
  <\/script>
</body>
</html>`
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd /workspace/claude-window && npx vitest run --project main tests/main/phoneServer.test.ts
```

Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/phoneServerHtml.ts window-manager/tests/main/phoneServer.test.ts
git commit -m "feat: add phone server HTML template"
```

---

### Task 3: Create phoneServer.ts (TDD)

**Files:**
- Modify: `window-manager/tests/main/phoneServer.test.ts` (add all server tests)
- Create: `window-manager/src/main/phoneServer.ts`

- [ ] **Step 1: Add all server tests to phoneServer.test.ts**

Append to `window-manager/tests/main/phoneServer.test.ts` (keep the 3 existing `getPhoneServerHtml` tests at the top, add everything below):

```typescript
import * as os from 'os'
import WebSocket from 'ws'
import {
  startPhoneServer,
  stopPhoneServer,
  getPhoneServerStatus,
  getTailscaleIp
} from '../../src/main/phoneServer'

vi.mock('../../src/main/windowService', () => ({
  listWindows: vi.fn()
}))
vi.mock('../../src/main/terminalService', () => ({
  getSession: vi.fn()
}))

import { listWindows } from '../../src/main/windowService'
import { getSession } from '../../src/main/terminalService'

const mockListWindows = vi.mocked(listWindows)
const mockGetSession = vi.mocked(getSession)

const MOCK_IFACES = {
  tailscale0: [{
    family: 'IPv4' as const,
    address: '100.1.2.3',
    internal: false,
    netmask: '255.0.0.0',
    mac: 'aa:bb:cc:dd:ee:ff',
    cidr: '100.1.2.3/8'
  }]
}

describe('getTailscaleIp', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 100.x.x.x address', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    expect(getTailscaleIp()).toBe('100.1.2.3')
  })

  it('returns null when no 100.x.x.x address', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth0: [{ family: 'IPv4' as const, address: '192.168.1.1', internal: false, netmask: '255.255.255.0', mac: 'aa:bb:cc:dd:ee:ff', cidr: '192.168.1.1/24' }]
    } as any)
    expect(getTailscaleIp()).toBeNull()
  })
})

describe('phoneServer lifecycle', () => {
  beforeEach(() => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    mockListWindows.mockResolvedValue([])
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('starts and returns url with tailscale ip', async () => {
    const result = await startPhoneServer(0)
    expect(result.url).toMatch(/^http:\/\/100\.1\.2\.3:\d+$/)
  })

  it('returns same url if already running', async () => {
    const first = await startPhoneServer(0)
    const second = await startPhoneServer(0)
    expect(first.url).toBe(second.url)
  })

  it('throws when no tailscale ip', async () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({} as any)
    await expect(startPhoneServer(0)).rejects.toThrow('Tailscale IP not found')
  })

  it('getPhoneServerStatus returns active after start', async () => {
    await startPhoneServer(0)
    const status = getPhoneServerStatus()
    expect(status.active).toBe(true)
    expect(status.url).toMatch(/^http:\/\/100\.1\.2\.3/)
  })

  it('getPhoneServerStatus returns inactive after stop', async () => {
    await startPhoneServer(0)
    stopPhoneServer()
    expect(getPhoneServerStatus()).toEqual({ active: false })
  })
})

describe('GET /api/windows', () => {
  beforeEach(() => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('returns JSON from listWindows', async () => {
    const windows = [{ id: 1, name: 'test', status: 'running', container_id: 'abc' }]
    mockListWindows.mockResolvedValue(windows as any)
    const { url } = await startPhoneServer(0)
    const port = new URL(url).port
    const res = await fetch(`http://localhost:${port}/api/windows`)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual(windows)
  })
})

describe('GET /', () => {
  beforeEach(() => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    mockListWindows.mockResolvedValue([])
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('returns HTML containing xterm', async () => {
    const { url } = await startPhoneServer(0)
    const port = new URL(url).port
    const res = await fetch(`http://localhost:${port}/`)
    expect(await res.text()).toContain('xterm')
  })
})

describe('WebSocket /ws/:containerId', () => {
  let port: number

  beforeEach(async () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue(MOCK_IFACES as any)
    mockListWindows.mockResolvedValue([])
    const { url } = await startPhoneServer(0)
    port = parseInt(new URL(url).port)
  })
  afterEach(() => { stopPhoneServer(); vi.restoreAllMocks() })

  it('closes with error on unknown containerId', async () => {
    mockGetSession.mockReturnValue(undefined)
    const client = new WebSocket(`ws://localhost:${port}/ws/unknown`)
    const messages: string[] = []
    await new Promise<void>(resolve => {
      client.on('message', d => messages.push(d.toString()))
      client.on('close', () => resolve())
    })
    expect(messages[0]).toContain('ERROR')
  })

  it('pipes PTY data to WebSocket client', async () => {
    let dataCallback: ((d: string) => void) | null = null
    const mockDisposable = { dispose: vi.fn() }
    const mockPty = {
      onData: vi.fn((cb: (d: string) => void) => { dataCallback = cb; return mockDisposable }),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn()
    }
    mockGetSession.mockReturnValue({ pty: mockPty } as any)

    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    const msgPromise = new Promise<string>(resolve => client.on('message', d => resolve(d.toString())))
    dataCallback!('hello from PTY')
    expect(await msgPromise).toBe('hello from PTY')
    client.close()
  })

  it('pipes WebSocket message to PTY write', async () => {
    const mockDisposable = { dispose: vi.fn() }
    const mockPty = {
      onData: vi.fn(() => mockDisposable),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn()
    }
    mockGetSession.mockReturnValue({ pty: mockPty } as any)

    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    client.send('user input')
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(mockPty.write).toHaveBeenCalledWith('user input')
    client.close()
  })

  it('closes WebSocket when PTY exits', async () => {
    let exitCallback: (() => void) | null = null
    const mockDisposable = { dispose: vi.fn() }
    const mockPty = {
      onData: vi.fn(() => mockDisposable),
      onExit: vi.fn((cb: () => void) => { exitCallback = cb; return mockDisposable }),
      write: vi.fn()
    }
    mockGetSession.mockReturnValue({ pty: mockPty } as any)

    const client = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await new Promise<void>(resolve => client.on('open', resolve))
    const closePromise = new Promise<void>(resolve => client.on('close', () => resolve()))
    exitCallback!()
    await closePromise
  })

  it('multiple connections all receive PTY output', async () => {
    const dataCallbacks: Array<(d: string) => void> = []
    const mockDisposable = { dispose: vi.fn() }
    const mockPty = {
      onData: vi.fn((cb: (d: string) => void) => { dataCallbacks.push(cb); return mockDisposable }),
      onExit: vi.fn(() => mockDisposable),
      write: vi.fn()
    }
    mockGetSession.mockReturnValue({ pty: mockPty } as any)

    const c1 = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    const c2 = new WebSocket(`ws://localhost:${port}/ws/container-1`)
    await Promise.all([
      new Promise<void>(resolve => c1.on('open', resolve)),
      new Promise<void>(resolve => c2.on('open', resolve))
    ])
    const m1 = new Promise<string>(resolve => c1.on('message', d => resolve(d.toString())))
    const m2 = new Promise<string>(resolve => c2.on('message', d => resolve(d.toString())))
    expect(dataCallbacks.length).toBe(2)
    dataCallbacks.forEach(cb => cb('broadcast'))
    expect(await m1).toBe('broadcast')
    expect(await m2).toBe('broadcast')
    c1.close(); c2.close()
  })
})
```

- [ ] **Step 2: Run to confirm all new tests fail**

```bash
cd /workspace/claude-window && npx vitest run --project main tests/main/phoneServer.test.ts
```

Expected: original 3 PASS, all new tests FAIL — `Cannot find module '../../src/main/phoneServer'`

- [ ] **Step 3: Create phoneServer.ts**

Create `window-manager/src/main/phoneServer.ts`:

```typescript
import http from 'http'
import os from 'os'
import type { AddressInfo } from 'net'
import { WebSocketServer, WebSocket } from 'ws'
import { listWindows } from './windowService'
import { getSession } from './terminalService'
import { getPhoneServerHtml } from './phoneServerHtml'

const DEFAULT_PORT = 8765

let httpServer: http.Server | null = null
let wss: WebSocketServer | null = null
let serverUrl: string | null = null

export function getTailscaleIp(): string | null {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const addr of ifaces ?? []) {
      if (addr.family === 'IPv4' && addr.address.startsWith('100.')) return addr.address
    }
  }
  return null
}

function handleWsConnection(ws: WebSocket, req: http.IncomingMessage): void {
  const match = req.url?.match(/^\/ws\/([^/]+)$/)
  if (!match) { ws.close(); return }
  const session = getSession(match[1], 'claude')
  if (!session) {
    ws.send('ERROR: No active claude session')
    ws.close()
    return
  }
  const onData = session.pty.onData(d => ws.send(d))
  const onExit = session.pty.onExit(() => ws.close())
  ws.on('message', msg => session.pty.write(msg.toString()))
  ws.on('close', () => { onData.dispose(); onExit.dispose() })
}

async function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.url === '/api/windows') {
    const windows = await listWindows()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(windows))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(getPhoneServerHtml())
}

export async function startPhoneServer(port = DEFAULT_PORT): Promise<{ url: string }> {
  if (httpServer) return { url: serverUrl! }
  const ip = getTailscaleIp()
  if (!ip) throw new Error('Tailscale IP not found (expected 100.x.x.x)')
  httpServer = http.createServer((req, res) => { void handleHttpRequest(req, res) })
  wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', handleWsConnection)
  await new Promise<void>((resolve, reject) => {
    httpServer!.listen(port, '0.0.0.0', resolve)
    httpServer!.once('error', reject)
  })
  const actualPort = (httpServer!.address() as AddressInfo).port
  serverUrl = `http://${ip}:${actualPort}`
  return { url: serverUrl }
}

export function stopPhoneServer(): void {
  wss?.clients.forEach(c => c.close())
  wss?.close()
  httpServer?.close()
  httpServer = null
  wss = null
  serverUrl = null
}

export function getPhoneServerStatus(): { active: boolean; url?: string } {
  return httpServer ? { active: true, url: serverUrl! } : { active: false }
}
```

- [ ] **Step 4: Run all tests to confirm pass**

```bash
cd /workspace/claude-window && npx vitest run --project main tests/main/phoneServer.test.ts
```

Expected: all 16 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/phoneServer.ts window-manager/tests/main/phoneServer.test.ts
git commit -m "feat: add phone server with HTTP and WebSocket support"
```

---

### Task 4: Add IPC handlers

**Files:**
- Modify: `window-manager/src/main/ipcHandlers.ts`

- [ ] **Step 1: Add import**

In `window-manager/src/main/ipcHandlers.ts`, add this import after the existing imports (before line 31 `import { startDepLogs...`):

```typescript
import { startPhoneServer, stopPhoneServer, getPhoneServerStatus } from './phoneServer'
```

- [ ] **Step 2: Add handlers**

Inside `registerIpcHandlers()`, append before the closing `}` (after the last `ipcMain` call, around line 285):

```typescript
  // Phone server handlers
  ipcMain.handle('phone-server:start', () => startPhoneServer())
  ipcMain.handle('phone-server:stop', () => stopPhoneServer())
  ipcMain.handle('phone-server:status', () => getPhoneServerStatus())
```

- [ ] **Step 3: Run existing tests to confirm no regressions**

```bash
cd /workspace/claude-window && npx vitest run --project main
```

Expected: all main-process tests PASS

- [ ] **Step 4: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/main/ipcHandlers.ts
git commit -m "feat: add phone-server IPC handlers"
```

---

### Task 5: Add preload entries

**Files:**
- Modify: `window-manager/src/preload/index.ts`

- [ ] **Step 1: Add phone server API**

In `window-manager/src/preload/index.ts`, before the closing `})` on the last line, add:

```typescript
  // Phone server API
  startPhoneServer: (): Promise<{ url: string }> =>
    ipcRenderer.invoke('phone-server:start'),
  stopPhoneServer: (): Promise<void> =>
    ipcRenderer.invoke('phone-server:stop'),
  getPhoneServerStatus: (): Promise<{ active: boolean; url?: string }> =>
    ipcRenderer.invoke('phone-server:status'),
```

- [ ] **Step 2: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/preload/index.ts
git commit -m "feat: expose phone server API via preload"
```

---

### Task 6: Add UI toggle to WindowDetailPane.svelte

**Files:**
- Modify: `window-manager/src/renderer/src/components/WindowDetailPane.svelte`

- [ ] **Step 1: Add phone server state (in `<script>` block)**

After the `let deleteArmed = $state(false)` line (around line 48), add:

```typescript
  let phoneActive = $state(false)
  let phoneUrl = $state<string | null>(null)
  let phoneError = $state<string | null>(null)

  async function togglePhone(): Promise<void> {
    phoneError = null
    if (phoneActive) {
      await window.api.stopPhoneServer()
      phoneActive = false
      phoneUrl = null
    } else {
      try {
        const result = await window.api.startPhoneServer()
        phoneActive = true
        phoneUrl = result.url
      } catch (e) {
        phoneError = e instanceof Error ? e.message : 'Failed to start'
      }
    }
  }
```

- [ ] **Step 2: Load initial status on mount**

Inside the `onMount(async () => {` block (around line 158), after the `void refreshBranch()` line, add:

```typescript
    const phoneStatus = await window.api.getPhoneServerStatus()
    phoneActive = phoneStatus.active
    phoneUrl = phoneStatus.url ?? null
```

- [ ] **Step 3: Add toggle button and URL display to template**

In the template, inside `.toggle-row` (around line 190, after the existing `{#each ... toggle-btn}` block and before the `{#if depContainers.length > 0}` block), add:

```svelte
    <button
      type="button"
      class="toggle-btn"
      class:active={phoneActive}
      aria-label="Phone Access"
      onclick={togglePhone}
    >Phone</button>
    {#if phoneActive && phoneUrl}
      <button
        type="button"
        class="phone-url-btn"
        title={phoneUrl}
        onclick={() => window.api.openExternal(phoneUrl!)}
      >{phoneUrl}</button>
    {/if}
    {#if phoneError}
      <span class="phone-error">{phoneError}</span>
    {/if}
```

- [ ] **Step 4: Add CSS for new elements**

In the `<style>` block, append before the closing `</style>`:

```css
  .phone-url-btn {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    padding: 0.18rem 0.45rem;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--accent);
    border-radius: 4px;
    cursor: pointer;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .phone-error {
    font-size: 0.7rem;
    color: #e55;
  }
```

- [ ] **Step 5: Run renderer tests to confirm no regressions**

```bash
cd /workspace/claude-window && npx vitest run --project renderer
```

Expected: all renderer tests PASS

- [ ] **Step 6: Commit**

```bash
cd /workspace/claude-window && git add window-manager/src/renderer/src/components/WindowDetailPane.svelte
git commit -m "feat: add Phone toggle button to WindowDetailPane"
```

---

### Task 7: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
cd /workspace/claude-window && npx vitest run
```

Expected: all tests PASS (main + renderer)

- [ ] **Step 2: Update CLAUDE.md**

Add to the `## Codebase Structure` section in `/home/node/.claude/CLAUDE.md`:

```markdown
### window-manager/src/main/phoneServer.ts
Exports: `startPhoneServer(port?)`, `stopPhoneServer`, `getPhoneServerStatus`, `getTailscaleIp`.
- Embeds HTTP + WebSocket server for phone access to Claude sessions over Tailscale.
- `startPhoneServer(port = 8765)` — detects Tailscale IP (100.x.x.x via os.networkInterfaces), starts http.Server + WebSocketServer, returns `{ url }`.
- `GET /` serves inline xterm.js phone UI (from phoneServerHtml.ts).
- `GET /api/windows` returns JSON from listWindows().
- `WS /ws/:containerId` attaches to the 'claude' PTY session from terminalService.getSession(); pipes pty.onData → ws.send, ws.message → pty.write; disposes listeners on close.
- Multiple WS connections to same PTY each attach their own listeners.
- IPC: `phone-server:start`, `phone-server:stop`, `phone-server:status` in ipcHandlers.ts.
- Tests: `window-manager/tests/main/phoneServer.test.ts` (16 tests).

### window-manager/src/main/phoneServerHtml.ts
Exports: `getPhoneServerHtml()` — returns inline HTML string for the phone browser UI.
- Window list view: fetches /api/windows, renders tappable cards.
- Terminal view: full-screen xterm.js (CDN 5.3.0) + FitAddon; WebSocket to /ws/:containerId.
- No build step; served directly as text/html.
```

- [ ] **Step 3: Final commit**

```bash
cd /workspace/claude-window && git add /home/node/.claude/CLAUDE.md
git commit -m "docs: update CLAUDE.md with phoneServer modules"
```
