# Conversation Summary — Design Spec

**Date:** 2026-04-15
**Status:** Approved

## Overview

On every Claude Code `Stop` event, an async background hook invokes a `claude --print` sub-agent that reads the session transcript and produces a short summary: a title and bullet points. The summary is written to `/tmp/claude-summary.json` inside the container. The Electron app polls for it (extending the existing waiting poller), sends it to the renderer via IPC, and displays it in the `WindowDetailPane` footer. When the user opens the commit modal, the summary pre-populates the subject and body fields.

## Data Flow

```
Claude Code Stop event (inside container)
  → async hook: bash /usr/local/bin/claude-summarize.sh
  → reads transcript_path from stdin JSON
  → invokes: claude --print "<summarize prompt>" < transcript
  → parses JSON output: { title: string, bullets: string[] }
  → writes /tmp/claude-summary.json

waitingPoller.ts (3s interval, per container)
  → existing: check /tmp/claude-waiting → dispatchWaiting()
  → NEW: check /tmp/claude-summary.json → read+delete → dispatchSummary()

dispatchSummary(containerId, { title, bullets })
  → win.webContents.send('terminal:summary', { containerId, title, bullets })

Renderer:
  → conversationSummary store (Map<containerId, { title, bullets }>)
  → WindowDetailPane reads store → summary-row below info-row
  → CommitModal opened with initialSubject=title, initialBody=bullets.join('\n')
```

Summary is in-memory only — never persisted to DB. Regenerated on every Stop event.

## Container Changes

### `files/claude-settings.json`

Add second hook entry under `Stop`, alongside the existing waiting marker hook:

```json
"Stop": [
  {
    "hooks": [
      { "type": "command", "command": "touch /tmp/claude-waiting 2>/dev/null; exit 0" }
    ]
  },
  {
    "hooks": [
      {
        "type": "command",
        "command": "bash /usr/local/bin/claude-summarize.sh",
        "async": true
      }
    ]
  }
]
```

### `files/claude-summarize.sh` (new file)

Copied into the container image via `Dockerfile` at `/usr/local/bin/claude-summarize.sh`.

```bash
#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
[[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]] && exit 0

RESULT=$(claude --print \
  --output-format json \
  "Read this conversation transcript and output ONLY a JSON object with two fields: \"title\" (string, ≤60 chars, summarizes what was accomplished) and \"bullets\" (array of ≤5 strings, key points). No markdown, no explanation." \
  < "$TRANSCRIPT" 2>/dev/null) || exit 0

printf '%s' "$RESULT" > /tmp/claude-summary.json
```

The script exits silently on any error — never blocks Claude. `async: true` means Claude does not wait for it.

### `files/Dockerfile`

Add:

```dockerfile
COPY claude-summarize.sh /usr/local/bin/claude-summarize.sh
RUN chmod +x /usr/local/bin/claude-summarize.sh
```

## Main Process Changes

### `window-manager/src/main/summaryDispatcher.ts` (new file)

Mirrors `waitingDispatcher.ts`:

```typescript
import { BrowserWindow } from 'electron'

export interface SummaryPayload {
  containerId: string
  title: string
  bullets: string[]
}

export function dispatchSummary(containerId: string, summary: { title: string; bullets: string[] }): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  win.webContents.send('terminal:summary', { containerId, ...summary } satisfies SummaryPayload)
}
```

### `window-manager/src/main/waitingPoller.ts`

Extend `checkOne` to also check and consume the summary file:

```typescript
import { dispatchSummary } from './summaryDispatcher'

async function checkOne(containerId: string): Promise<void> {
  const container = getDocker().getContainer(containerId)

  // existing waiting check (unchanged)
  const r = await execInContainer(container, [
    'sh', '-c',
    `test -e ${MARKER} && rm -f ${MARKER} && echo Y`
  ])
  if (r.ok && r.stdout.trim() === 'Y') dispatchWaiting(containerId)

  // new: read-and-delete summary file
  const s = await execInContainer(container, [
    'sh', '-c',
    'test -f /tmp/claude-summary.json && cat /tmp/claude-summary.json && rm -f /tmp/claude-summary.json'
  ])
  if (s.ok && s.stdout.trim()) {
    try {
      const summary = JSON.parse(s.stdout.trim()) as { title: string; bullets: string[] }
      if (summary.title && Array.isArray(summary.bullets)) {
        dispatchSummary(containerId, summary)
      }
    } catch { /* malformed JSON — skip */ }
  }
}
```

### `window-manager/src/preload/index.ts` + `index.d.ts`

Expose two new IPC listeners:

```typescript
onTerminalSummary: (cb: (data: { containerId: string; title: string; bullets: string[] }) => void) => void
offTerminalSummary: () => void
```

## Renderer Changes

### `window-manager/src/renderer/src/lib/conversationSummary.ts` (new file)

```typescript
import { writable } from 'svelte/store'

export interface ConversationSummary {
  title: string
  bullets: string[]
}

function createSummaryStore() {
  const { subscribe, update } = writable<Map<string, ConversationSummary>>(new Map())
  return {
    subscribe,
    set: (containerId: string, summary: ConversationSummary) =>
      update(m => { m.set(containerId, summary); return new Map(m) }),
    remove: (containerId: string) =>
      update(m => { m.delete(containerId); return new Map(m) })
  }
}

export const conversationSummary = createSummaryStore()
```

### `window-manager/src/renderer/src/components/TerminalHost.svelte`

- Import `conversationSummary` store
- On mount: register `window.api.onTerminalSummary` listener
- Listener: if `containerId === win.container_id`, call `conversationSummary.set(containerId, { title, bullets })`
- On destroy: `window.api.offTerminalSummary()` + `conversationSummary.remove(win.container_id)`
- Pass `summary={$conversationSummary.get(win.container_id)}` to `WindowDetailPane`
- Pass `initialSubject` and `initialBody` to `CommitModal` from store value

### `window-manager/src/renderer/src/components/WindowDetailPane.svelte`

New optional prop `summary?: ConversationSummary`. New `summary-row` div inserted below `info-row`:

```svelte
{#if summary}
  <div class="summary-row">
    <span class="summary-title">{summary.title}</span>
    <ul class="summary-bullets">
      {#each summary.bullets as b}<li>{b}</li>{/each}
    </ul>
  </div>
{/if}
```

Styled to match existing footer density (small font, muted colors).

### `window-manager/src/renderer/src/components/CommitModal.svelte`

Add `initialSubject` and `initialBody` props:

```typescript
let { onSubmit, onCancel, busy, initialSubject = '', initialBody = '' } = $props()
let subject = $state(initialSubject)
let body = $state(initialBody)
```

Fields remain editable — user can modify before submitting.

## Files Changed

| File | Change |
|---|---|
| `files/claude-settings.json` | Add async Stop hook entry |
| `files/claude-summarize.sh` | New script (sub-agent runner) |
| `files/Dockerfile` | Copy + chmod script |
| `window-manager/src/main/summaryDispatcher.ts` | New — IPC dispatch |
| `window-manager/src/main/waitingPoller.ts` | Extend checkOne for summary file |
| `window-manager/src/preload/index.ts` | Expose onTerminalSummary / offTerminalSummary |
| `window-manager/src/preload/index.d.ts` | Update Api type |
| `window-manager/src/renderer/src/lib/conversationSummary.ts` | New store |
| `window-manager/src/renderer/src/components/TerminalHost.svelte` | IPC listener + store wiring |
| `window-manager/src/renderer/src/components/WindowDetailPane.svelte` | summary-row display |
| `window-manager/src/renderer/src/components/CommitModal.svelte` | initialSubject / initialBody props |

## Testing

Unit tests required for:
- `summaryDispatcher.ts` — IPC send behavior
- `waitingPoller.ts` — summary file read/parse/dispatch path
- `conversationSummary.ts` store — set/remove behavior
- `CommitModal` — initialSubject/initialBody prop initialization
- `WindowDetailPane` — summary-row renders when prop present, hidden when absent
