# Design: Claude Inject Button + Project Port Mapping

**Date:** 2026-04-15  
**Branch:** add-port  
**Scope:** Two independent features in the window manager Electron/Svelte app

---

## Feature 1 — Claude Inject Button

### Summary

Add a button to `WindowDetailPane.svelte` that sends `claude --dangerously-skip-permissions` to the active terminal and executes it.

### Components Touched

- `window-manager/src/renderer/src/components/WindowDetailPane.svelte` — add button

### Behavior

- Button label: `Claude`
- Disabled when container status is not `running` (same gate as Commit/Push buttons)
- On click: call `window.api.sendTerminalInput(containerId, '\x15claude --dangerously-skip-permissions\n')`
  - `\x15` = Ctrl+U — clears any pending input on the current line
  - Command + `\n` executes immediately in the tmux session

### No New API Surface

Uses existing `sendTerminalInput` IPC path. No new handlers, no new preload bindings.

---

## Feature 2 — Project Port Mapping

### Summary

Allow users to specify container ports when creating a project. Each window (container) created for that project will have those ports mapped to ephemeral host ports. The assigned host ports are displayed in `WindowDetailPane`.

### Data Model

**`projects` table** — add column:
```sql
ports TEXT DEFAULT NULL  -- JSON array of ints, e.g. [3000, 8080]
```

**`windows` table** — add column:
```sql
ports TEXT DEFAULT NULL  -- JSON object, e.g. {"3000": "54321", "8080": "54322"}
```

**`ProjectRecord` type** — add field:
```typescript
ports?: string  // raw JSON
```

**`WindowRecord` type** — add field:
```typescript
ports?: string  // raw JSON
```

### Project Creation UI (`NewProjectWizard.svelte`)

Add optional text input below existing fields:

- Label: `Ports`
- Placeholder: `3000, 8080`
- Free-text comma-separated port numbers
- Parsed to `number[]` on submit; empty/blank → `null`
- Passed to `createProject(name, gitUrl, ports?)`

### Backend: `projectService.createProject()`

- Accept optional `ports: number[]`
- Validate: each value must be integer 1–65535
- Store `JSON.stringify(ports)` (or `null`) in `projects.ports`
- Return `ports` field on `ProjectRecord`

### Window Creation: `windowService.createWindow()`

1. Look up project record to get `ports` array
2. If ports exist, build Docker config:
   ```typescript
   ExposedPorts: { '3000/tcp': {}, '8080/tcp': {} }
   HostConfig: {
     PortBindings: {
       '3000/tcp': [{ HostPort: '' }],  // empty = ephemeral
       '8080/tcp': [{ HostPort: '' }]
     }
   }
   ```
3. After `container.start()`, call `container.inspect()`
4. Extract assigned host ports from `info.NetworkSettings.Ports`
5. Store `JSON.stringify(portMap)` in `windows.ports` on the DB record
6. Return `ports` field on `WindowRecord`

### Window Detail Pane (`WindowDetailPane.svelte`)

If `window.ports` is non-null, render mapped ports below branch line:

```
container :3000 → host :54321
container :8080 → host :54322
```

Display is static (ports don't change while container runs). No polling needed.

### IPC / API Changes

- `createProject(name, gitUrl, ports?)` — add optional `ports` param
- `ProjectRecord` — add `ports?: string`
- `WindowRecord` — add `ports?: string`
- `listWindows()` — already returns full record; no change needed once column added
- `createWindow()` — internally uses project ports; no signature change

### DB Migration

`db.ts` `initDb()` uses `CREATE TABLE IF NOT EXISTS` with no migration system. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on startup for both columns.

---

## Out of Scope

- Editing ports on an existing project
- Per-window port overrides
- Displaying ports in `ProjectView`
- Port conflict detection
- UDP port support
