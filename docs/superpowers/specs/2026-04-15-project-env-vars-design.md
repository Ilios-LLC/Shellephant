# Project Environment Variables — Design Spec

**Date:** 2026-04-15  
**Branch:** project-env-vars  
**Status:** Approved

## Summary

Add per-project environment variables that are injected into every Docker container (window) created under that project. Managed via a project settings panel accessed from a gear icon in the sidebar.

---

## Data Layer

### Schema

Add `env_vars TEXT DEFAULT NULL` column to the `projects` table via SQLite migration. Stores a JSON object `{"KEY": "value", ...}`. Mirrors the existing `ports` column pattern exactly.

```sql
ALTER TABLE projects ADD COLUMN env_vars TEXT DEFAULT NULL;
```

### Types

`ProjectRecord` (in `types.ts`) gains:

```ts
env_vars: string | null  // JSON-serialized Record<string, string>
```

### IPC Handlers

Two new handlers registered in `ipcHandlers.ts`:

| Channel | Args | Returns | Description |
|---|---|---|---|
| `project:get` | `id: number` | `ProjectRecord` | Fetch single project by ID |
| `project:update-env-vars` | `id: number, envVars: Record<string, string>` | `void` | Serialize to JSON and save |

### Window Creation

In `windowService.ts`, `createWindow()` reads `env_vars` from the project record, parses the JSON, and spreads the key-value pairs into the Docker container's `Env` array alongside the existing `CLAUDE_CODE_OAUTH_TOKEN`.

```ts
const projectEnvVars = project.env_vars
  ? Object.entries(JSON.parse(project.env_vars)).map(([k, v]) => `${k}=${v}`)
  : []

Env: [
  `CLAUDE_CODE_OAUTH_TOKEN=${claudeToken}`,
  ...projectEnvVars,
]
```

---

## UI Layer

### Sidebar — Gear Icon

Each project row in the sidebar renders a gear icon (⚙) inline next to the project name. Clicking it opens `ProjectSettingsView` as a modal overlay.

### `ProjectSettingsView.svelte`

New component following the same card/wizard styling as `SettingsView.svelte`.

**Layout:**
- Header: "Project Settings — {project.name}"
- Section title: "Environment Variables"
- Key-value table:
  - Each row: `[key input]` `=` `[value input]` `[× button]`
  - `+ Add Variable` button appends an empty row
- Footer: `Cancel` button (discard changes, close modal) + `Save` button (call `project:update-env-vars`, close modal)

**Behavior:**
- On open: call `project:get(id)`, parse `env_vars` JSON into local row state
- On save: filter rows with non-empty keys, build `Record<string, string>`, call `project:update-env-vars`
- Duplicate keys: last row wins (standard env var behavior, no error shown)
- No other validation required

---

## Out of Scope

- Encryption of env var values (stored plain text)
- Per-window env var overrides
- Env var inheritance between project groups
- Validation of key format (e.g., no spaces)
