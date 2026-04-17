# Multi-Project Windows Design

**Date:** 2026-04-17  
**Status:** Approved

## Overview

Two related changes:
1. Set `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` and launch claude with `--dangerously-skip-permissions --add-dir <path>` per project.
2. Allow windows to span multiple equal projects — all repos cloned into one container, one claude session, per-project commit/push/editor controls.

---

## Section 1 — Env Vars & Claude Launch

### New env var

Add `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` to both:
- `files/Dockerfile` (alongside `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
- `files/claude-settings.json` (env block)

### Claude invocation (`terminalService.ts`)

Current:
```bash
exec tmux -u new-session -A -s cw-claude -c '/workspace/reponame' 'bash -c "claude; exec bash"'
```

New (single-project):
```bash
exec tmux -u new-session -A -s cw-claude -c '/workspace/reponame' 'bash -c "claude --dangerously-skip-permissions --add-dir /workspace/reponame; exec bash"'
```

New (multi-project):
```bash
exec tmux -u new-session -A -s cw-claude -c '/workspace' 'bash -c "claude --dangerously-skip-permissions --add-dir /workspace/proj1 --add-dir /workspace/proj2; exec bash"'
```

- Single-project: tmux cwd = project's clone path (preserves current behavior)
- Multi-project: tmux cwd = `/workspace` (no single home)
- `--add-dir` args built from `window_projects.clone_path` values at session open time

---

## Section 2 — DB Schema

### New table: `window_projects`

```sql
CREATE TABLE window_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  window_id INTEGER NOT NULL REFERENCES windows(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  clone_path TEXT NOT NULL,
  UNIQUE(window_id, project_id)
);
```

### Change to `windows` table

`project_id` becomes nullable. SQLite does not support `ALTER COLUMN`, so this uses the standard rename-create-copy-drop migration pattern in `db.ts`:

1. Rename `windows` → `windows_old`
2. Create new `windows` with `project_id INTEGER REFERENCES projects(id)` (no NOT NULL)
3. Copy all rows from `windows_old`
4. Drop `windows_old`

`project_id = null` indicates a multi-project window.

### Migration

All existing single-project windows are backfilled with one `window_projects` row using their current `project_id` and computed `clone_path` (`/workspace/{repo-slug}/`).

### Updated types

```typescript
interface WindowProjectRecord {
  id: number
  window_id: number
  project_id: number
  clone_path: string
  project?: ProjectRecord  // joined
}

interface WindowRecord {
  id: number
  name: string
  project_id: number | null        // null = multi-project
  container_id: string
  ports?: string
  network_id?: string | null
  created_at: string
  status: 'running' | 'stopped' | 'unknown'
  projects: WindowProjectRecord[]  // always populated by listWindows
}
```

---

## Section 3 — Window Creation (Backend)

### `createWindow()` signature

```typescript
createWindow(
  name: string,
  projectIds: number[],            // replaces single projectId
  withDeps?: boolean,
  onProgress?: ProgressReporter
): Promise<WindowRecord>
```

### Single-project path (`projectIds.length === 1`)

Behavior identical to today:
- Clone at `/workspace/{repo-slug}/`
- `windows.project_id = projectIds[0]`
- Write one `window_projects` row

### Multi-project path (`projectIds.length > 1`)

- `windows.project_id = null`
- Clone each project sequentially into `/workspace/{repo-slug}/`
- Apply window slug as branch name in each repo independently
- Write one `window_projects` row per project
- `--add-dir` args assembled from all `clone_path` values at terminal launch

### `listWindows()` update

Joins `window_projects` + `projects` to populate `WindowRecord.projects[]` for all windows.

### IPC handler update

`ipcHandlers.ts` passes `projectIds: number[]` from renderer to `createWindow`.

---

## Section 4 — UI: Creation Flow

### Sidebar

"＋ Multi-Project Window" button rendered below the full projects sidebar (below all groups and project entries), always visible. Opens `NewWindowWizard` in multi-project mode.

### `NewWindowWizard` modes

**Single-project mode** (unchanged — opened from a project's "+" button):
- Window name input
- Optional "Start with dependencies" checkbox
- Same progress steps, same error handling

**Multi-project mode** (opened from sidebar "＋ Multi-Project Window"):
- Checkbox list of all existing projects (requires ≥2 selected to enable Create)
- Window name input
- "Start with dependencies" checkbox if any selected project has deps
- Same progress steps and error handling as single-project

No other changes to creation flow.

---

## Section 5 — UI: Bottom Panel & Editor

### `WindowDetailPane`

**Single-project window:** identical to today — one Commit, Push, Delete row.

**Multi-project window:** per-project rows replace the single row:

```
[project-a]  Commit  Push  Editor
[project-b]  Commit  Push  Editor
```

- Commit/Push target that project's `clone_path` via git ops
- Two-click delete remains at window level (one Delete button, not per-project)
- Panel toggle buttons (Claude/Terminal/Editor global) unchanged

### `CommitModal`

Receives `projectId: number` and `clonePath: string` to scope all git operations to the correct directory.

### `FileTree.svelte`

Prop change:

```typescript
// Before
props: { containerId: string, rootPath: string, onFileSelect: (path) => void }

// After
props: { containerId: string, roots: { rootPath: string, label: string }[], onFileSelect: (path) => void }
```

- Each root renders as a top-level collapsible node labeled with the project name
- Single-project windows pass a one-element `roots` array — behavior identical to today
- Clicking a per-project "Editor" button in `WindowDetailPane` makes the editor panel visible (if hidden) and scrolls/expands to that project's root node

### `EditorPane` / `TerminalHost`

Updated to pass `roots[]` to `FileTree` instead of single `rootPath`. For single-project windows, `roots` is derived from the one `window_projects` row.

---

## Out of Scope

- Per-project terminal sessions (single shared terminal)
- Per-project dependency containers for multi-project windows
- Removing projects from an existing multi-project window after creation
