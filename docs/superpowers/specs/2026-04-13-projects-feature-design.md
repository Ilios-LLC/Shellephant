# Projects Feature Design

## Overview

Add "projects" as first-class entities to the window manager. A project represents a git repository (SSH URL). Windows are created from projects, with the repo automatically cloned into the container at `/workspace/{repo-name}`. All windows must belong to a project — standalone windows are removed.

## Data Model

### New `projects` table

```sql
CREATE TABLE projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  git_url    TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL
)
```

### Modified `windows` table

```sql
ALTER TABLE windows ADD COLUMN project_id INTEGER NOT NULL REFERENCES projects(id)
```

- Soft deletes on projects (same pattern as windows)
- `git_url` has unique constraint — no duplicate projects for same repo
- Window `name` still exists (user names each window), but `project_id` is required
- Migration: drop and recreate DB (pre-release, acceptable)

## Validation & Auth

### SSH URL validation — two stages

1. **Syntax check** — regex validates SSH git URL format:
   - `git@github.com:org/repo.git` (`.git` suffix optional)
   - `git@gitlab.com:org/repo.git`
   - Reject HTTPS URLs, reject malformed strings

2. **Remote check** — `git ls-remote {url}` using PAT to verify repo exists and is accessible. Runs from host (main process).

### PAT handling

- App reads `GITHUB_PAT` env var at startup
- Used for `git ls-remote` validation on the host: converts SSH URL to HTTPS format temporarily for the remote check (e.g., `git@github.com:org/repo.git` → `https://{PAT}@github.com/org/repo.git`) since host may not have SSH keys configured
- Not needed for clone inside container — SSH keys handle that
- If PAT missing, skip remote validation, syntax-only fallback with warning to user

### SSH keys in container

- Already handled by existing Dockerfile/entrypoint (`docker-entrypoint.sh` has SSH/GitHub setup)
- No changes needed — clone inside container uses container's SSH config

## Relationships

- One project can have many windows (1:many)
- All windows must belong to a project (no standalone windows)
- Deleting a project cascade soft-deletes all its windows and stops their containers

## Window Creation Flow

1. User selects project in sidebar
2. User clicks "New Window" within project view
3. User enters window name
4. Main process `createWindow(name, projectId)`:
   - Look up project git URL from DB
   - Create container from `cc` image (existing logic)
   - Start container
   - Insert row to `windows` table with `project_id`
   - `docker exec` into container: `git clone {git_url} /workspace/{repo-name}`
   - Configure tmux session to `cd /workspace/{repo-name}` on attach
5. Terminal opens, user lands in cloned repo directory

- Clone happens synchronously during window creation. UI shows loading state.
- Repo name derived from SSH URL: `git@github.com:org/my-repo.git` → `my-repo`

## UI Changes

### Sidebar restructure

**Current:** flat list of windows + create button at top.

**New:**
- **"Add Project" button** at top of sidebar
- **Project list** — each project shows name + git URL snippet
- **Click project** → main pane shows project detail view with:
  - Project name + full git URL
  - List of windows belonging to project
  - "New Window" button
  - "Delete Project" button
- **Click window** (within project view) → switches to terminal view (existing behavior)

### Add Project flow

1. Click "Add Project"
2. Form: SSH git URL input + optional custom name input
3. On submit: validate SSH URL syntax → remote check via `git ls-remote` → save to DB
4. If name empty, derive from URL (`git@github.com:org/my-repo.git` → `my-repo`)
5. Validation errors shown inline

### Delete Project flow

- Confirm dialog using existing 3-second timeout button pattern
- Cascade: soft-delete project + all its windows, stop all containers

### Removed

- Standalone window creation (no more "create window with just a name")

## IPC Channels

### New channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `project:create` | invoke | Validate SSH URL + save project |
| `project:list` | invoke | Fetch active projects (deleted_at IS NULL) |
| `project:delete` | invoke | Cascade soft-delete project + all windows |

### Modified channels

| Channel | Change |
|---------|--------|
| `window:create` | Now requires `projectId` param, triggers git clone |
| `window:list` | Add optional `projectId` filter |

## Service Layer

### New: `projectService.ts`

- `createProject(name: string, gitUrl: string): Promise<Project>` — validate URL, `git ls-remote`, insert to DB
- `listProjects(): Promise<Project[]>` — fetch active projects
- `deleteProject(id: number): Promise<void>` — soft-delete project, cascade delete all windows, stop containers

### Modified: `windowService.ts`

- `createWindow(name: string, projectId: number)` — look up project git URL, create container, clone repo into `/workspace/{repo-name}`, insert row with `project_id`
- `listWindows(projectId?: number)` — filter by project when provided

### Preload API additions

```typescript
createProject(name: string, gitUrl: string): Promise<Project>
listProjects(): Promise<Project[]>
deleteProject(id: number): Promise<void>
```

## Error Handling

### Validation errors

- Invalid SSH URL format → inline error in form, no save
- `git ls-remote` fails → "Repository not accessible" error, no save
- Duplicate git URL → "Project already exists" error, no save
- No `GITHUB_PAT` env var → skip remote check, syntax-only with warning

### Clone errors

- Clone fails during window creation → container exists but error shown to user. Window still saved, user can retry by deleting and recreating.
- SSH key not configured in container → clone fails, same handling

### Cascade delete errors

- Container already removed externally → ignore, continue soft-delete (existing idempotent pattern)

### Reconciliation

- Existing `reconcileWindows()` unchanged — still syncs DB state with actual containers
- Orphaned windows handled by cascade stopping containers on project delete
