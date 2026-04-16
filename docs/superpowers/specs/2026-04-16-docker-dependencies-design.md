# Docker Dependencies Design

**Date:** 2026-04-16  
**Status:** Approved

## Overview

Allow users to define Docker image dependencies per project. When creating a window, an optional toggle causes the system to spin up each dependency as its own container, all connected on a shared bridge network alongside the main container. Dependencies are discovered via Docker's built-in bridge DNS using image-name aliases.

---

## Data Model

### New table: `project_dependencies`

```sql
CREATE TABLE project_dependencies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  image      TEXT NOT NULL,        -- e.g. "postgres", "ghcr.io/foo/bar"
  tag        TEXT NOT NULL DEFAULT 'latest',
  env_vars   TEXT DEFAULT NULL,    -- JSON object e.g. {"POSTGRES_PASSWORD":"secret"}
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### New table: `window_dependency_containers`

```sql
CREATE TABLE window_dependency_containers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  window_id     INTEGER NOT NULL REFERENCES windows(id),
  dependency_id INTEGER NOT NULL REFERENCES project_dependencies(id),
  container_id  TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Migration: add `network_id` to `windows`

```sql
ALTER TABLE windows ADD COLUMN network_id TEXT DEFAULT NULL;
```

`network_id` stores the Docker bridge network ID created for the window when dependencies are enabled.

---

## Image Validation

Validation runs in the main process as part of `project:dep-create` and `project:dep-update`. Dep is not written to DB until validation passes.

### Parsing image string

| Input | Registry | Namespace | Name |
|---|---|---|---|
| `postgres` | Docker Hub | `library` | `postgres` |
| `myuser/myimage` | Docker Hub | `myuser` | `myimage` |
| `ghcr.io/foo/bar` | `ghcr.io` | `foo` | `bar` |
| `gcr.io/project/img` | `gcr.io` | `project` | `img` |

Tag is split from the last `:` segment if present; defaults to `latest`.

### Docker Hub

```
GET https://hub.docker.com/v2/repositories/{namespace}/{name}/tags/{tag}/
```

- 200 → valid
- 404 → image/tag not found, show user-facing error
- Other non-2xx → show generic registry error

### Other registries (ghcr.io, gcr.io, etc.)

Anonymous token exchange, then:

```
GET https://{registry}/v2/{name}/manifests/{tag}
Accept: application/vnd.docker.distribution.manifest.v2+json
```

- 200 → valid
- 404 → not found
- 401/403 → image is private, reject with message "Image must be public"

---

## UI Changes

### ProjectView — Dependencies tab

New tab added to project detail view alongside existing tabs.

- Lists saved deps: `image:tag`, with expandable env var section
- **Add dependency form:**
  - Image input (e.g. `postgres` or `ghcr.io/foo/bar`)
  - Tag input (default: `latest`)
  - Key/value env var pairs (add/remove rows)
  - Save button — triggers validation before writing; inline error on failure
- Per-dep delete button (two-click pattern consistent with existing project/window delete)

### NewWindowWizard — Dependencies toggle

- Only rendered when project has ≥1 saved dependency
- Checkbox: **"Start with dependencies"**
- When checked, creation progress steps expand to show per-dep pull + start steps

### WindowDetailPane — Dep Logs tab (4th tab)

- Only visible when window has `window_dependency_containers` rows
- Sub-tabs or dropdown to select which dep container to view logs for
- Streams `docker logs --follow` output, auto-scrolls, formatted as monospace text
- Subscribes on mount/tab-select, unsubscribes on tab-switch/destroy

---

## Window Creation with Dependencies

When "Start with dependencies" toggle is enabled, `createWindow()` in `windowService.ts` gains the following steps before the existing flow:

1. **Create bridge network**
   - Name: `cw-{window-slug}-net`
   - Store returned `network_id` on the window row

2. **For each dependency** (sequential):
   - Emit progress: `"Pulling {image}:{tag}..."`
   - Pull image via `docker pull`
   - Emit progress: `"Starting {image}:{tag}..."`
   - Create container:
     - Name: `cw-{window-slug}-{image-basename}` (e.g. `cw-myapp-postgres`)
     - Env vars from `project_dependencies.env_vars`
     - Attached to bridge network
     - Network alias = image basename (e.g. `postgres` from `postgres:15`, `bar` from `ghcr.io/foo/bar:latest`)
   - Start container
   - Collect container ID in memory (not yet written to DB)
   - **On failure:** stop+remove all dep containers started so far, remove bridge network, emit failure log to UI, abort window creation (no DB rows written)

3. **Create main container** attached to same bridge network — existing flow continues unchanged (clone, checkout, etc.)

4. **On success:** insert window row (with `network_id`) and all `window_dependency_containers` rows atomically at the end of the flow, consistent with existing behavior where the window row is only written after all steps succeed.

### DNS / Service Discovery

Docker bridge network resolves aliases automatically. Main container connects to deps using image basename as hostname:

- `postgres` → dep container running `postgres:15`
- `redis` → dep container running `redis:alpine`

No env var injection or manual configuration required in the main container.

---

## Window Deletion

On window delete, before existing container cleanup:

1. For each row in `window_dependency_containers` for this window:
   - Stop container
   - Remove container
2. If `windows.network_id` is set: remove bridge network
3. Existing main container stop+remove flow continues

---

## Dep Logs Streaming

New service: `depLogsService.ts`

- Stores active log streams by container ID
- `startLogs(containerId, onData)`: calls `container.logs({ follow: true, stdout: true, stderr: true, timestamps: true })`, streams chunks via callback
- `stopLogs(containerId)`: destroys stream, removes from active map

New IPC handlers:
- `window:dep-logs-start(windowId, containerId)` → starts stream, sends chunks as `window:dep-logs-data` events
- `window:dep-logs-stop(containerId)` → stops stream

---

## New Services & IPC

### `dependencyService.ts`

- `listDependencies(projectId)` → `ProjectDependency[]`
- `createDependency(projectId, {image, tag, envVars})` → validates image, inserts row
- `updateDependency(id, {image, tag, envVars})` → validates image, updates row
- `deleteDependency(id)` → removes row
- `validateImage(image, tag)` → registry API check, throws with user-facing message on failure

### New IPC channels

| Channel | Direction | Description |
|---|---|---|
| `project:dep-list` | invoke | List deps for project |
| `project:dep-create` | invoke | Validate + create dep |
| `project:dep-update` | invoke | Validate + update dep |
| `project:dep-delete` | invoke | Delete dep |
| `window:dep-logs-start` | invoke | Start streaming dep container logs |
| `window:dep-logs-stop` | send | Stop streaming |
| `window:dep-logs-data` | event → renderer | Streamed log chunk |

### New TypeScript types

```typescript
interface ProjectDependency {
  id: number
  project_id: number
  image: string
  tag: string
  env_vars: Record<string, string> | null
  created_at: string
}

interface WindowDependencyContainer {
  id: number
  window_id: number
  dependency_id: number
  container_id: string
  created_at: string
}
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Image not found on registry | Inline error in dep form, dep not saved |
| Image is private | Inline error: "Image must be public" |
| Dep container fails to start | Abort window creation: clean up all dep containers + network, show error with logs |
| Dep container exits after creation | Visible in Dep Logs tab; main container unaffected |
| Window deleted with running deps | Stop+remove all dep containers and network before main container cleanup |

---

## Testing

- Unit tests for `dependencyService.ts`: CRUD, image string parsing, validation error cases
- Unit tests for `depLogsService.ts`: stream start/stop, cleanup on destroy
- Unit tests for `windowService.ts` additions: dep creation flow, abort/cleanup on failure
- Unit tests for `ProjectView` dependencies tab: add/remove dep, validation error display
- Unit tests for `NewWindowWizard`: toggle visibility rules, toggle state passed to creation
- Unit tests for `WindowDetailPane` dep logs tab: visibility rules, stream lifecycle
