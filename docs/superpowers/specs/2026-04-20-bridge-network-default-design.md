# Bridge Network Default — Design Spec

**Date:** 2026-04-20
**Status:** Approved

## Overview

Allow a project to store a default bridge network. When creating a window, users choose between three mutually exclusive network modes: auto-create (vWindow creates `cw-{slug}-net`), use the project default, or specify a custom network name. The `withDeps` toggle and the network section are mutually exclusive — enabling deps locks the network section with an explanatory message.

## Data Layer

### DB Migration
Add `default_network TEXT DEFAULT NULL` to the `projects` table.

```sql
ALTER TABLE projects ADD COLUMN default_network TEXT DEFAULT NULL;
```

### Type Changes
`ProjectRecord` gains `default_network: string | null`.

`listProjects` and `getProject` queries include the new column.

### New Service Function
`projectService.ts` — `updateProjectDefaultNetwork(id: number, network: string | null): Promise<void>`

Updates the `default_network` column for the given project. Rejects on invalid id.

### New Docker Utility
`docker.ts` — `listBridgeNetworks(): Promise<{ id: string; name: string }[]>`

Calls `docker.listNetworks({ filters: { driver: ['bridge'] } })`. Strips Docker internals: `bridge`, `host`, `none`. Returns `{ id, name }[]` sorted by name.

### New IPC Handlers
| Channel | Handler |
|---|---|
| `project:update-default-network` | `updateProjectDefaultNetwork(id, network)` |
| `docker:list-bridge-networks` | `listBridgeNetworks()` |

### New Preload Methods
```typescript
updateProjectDefaultNetwork: (id: number, network: string | null) => ipcRenderer.invoke('project:update-default-network', id, network)
listDockerNetworks: () => ipcRenderer.invoke('docker:list-bridge-networks')
```

## Project Settings UI

**File:** `ProjectSettingsView.svelte`

New "Default Bridge Network" section added alongside env vars and ports:

- On mount, `listDockerNetworks()` called in parallel with existing data loads.
- `<select>` dropdown: first option "None (no default)", then one `<option>` per bridge network (name as display and value).
- Refresh icon button next to dropdown re-calls `listDockerNetworks()`.
- On change, calls `updateProjectDefaultNetwork(project.id, value || null)` immediately (no save button — matches existing group select pattern in `ProjectView`).
- Selected value initializes from `project.default_network`.

## Window Creation Wizard

**File:** `NewWindowWizard.svelte`

Replace existing Docker network text input with a radio group:

### Radio Options
| Option | Condition | `netArg` value |
|---|---|---|
| Auto-create | Always enabled | `''` (empty string) |
| Use project default | Disabled + tooltip "No default set" when `project.default_network` is null | `project.default_network` |
| Custom | Always enabled; reveals text input below | `customInput.trim()` |

### Default Selection
- "Use project default" pre-selected when `project.default_network` is non-null.
- "Auto-create" pre-selected otherwise.

### `withDeps` Interaction
- Entire network `<fieldset>` is `disabled` when `withDeps=true`.
- Disabled message: "Network auto-created when dependencies enabled."
- `withDeps` toggle and network radio are mutually exclusive — they do not affect each other's state, just the network section's enabled/disabled state.

### Data Flow
`project.default_network` is available via `listProjects` (already loaded by the time the wizard opens). No additional fetch needed.

### Multi-Project Windows
When the wizard is opened for multiple projects simultaneously, "Use project default" is disabled (network defaults are per-project; no single default applies). Only "Auto-create" and "Custom" are available in this case.

## Testing

### `docker.test.ts`
- `listBridgeNetworks()` returns only bridge-driver networks.
- Internal networks (`bridge`, `host`, `none`) are stripped.
- Returns empty array when no user-created bridge networks exist.

### `projectService.test.ts`
- `updateProjectDefaultNetwork` sets a network name.
- `updateProjectDefaultNetwork` clears to null.
- Rejects on invalid project id.

### `ProjectSettingsView.test.ts`
- Network dropdown renders with fetched network names.
- "None" option present and selected when `project.default_network` is null.
- Selecting a network calls `updateProjectDefaultNetwork`.
- Refresh button re-calls `listDockerNetworks`.

### `NewWindowWizard.test.ts`
- Radio group renders all three options.
- "Use project default" disabled when `project.default_network` is null.
- Pre-selects "Use project default" when default is set.
- Pre-selects "Auto-create" when no default.
- `withDeps=true` disables network fieldset and shows message.
- Correct `netArg` passed for each radio selection.
- Custom option reveals text input.
