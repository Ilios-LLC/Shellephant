# Project Groups Design

**Date:** 2026-04-15  
**Branch:** project-groups  
**Status:** Approved

---

## Overview

Add project groups to Shellephant. Users can create named groups, assign projects to a group, and filter the sidebar project list by clicking a group icon at the bottom of the sidebar.

---

## Data Layer

### New table: `project_groups`

```sql
CREATE TABLE IF NOT EXISTS project_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Migration: `projects` table

Add `group_id` column (nullable FK):

```sql
ALTER TABLE projects ADD COLUMN group_id INTEGER REFERENCES project_groups(id) DEFAULT NULL
```

Applied via the existing pragma-check + `ALTER TABLE` migration pattern in `db.ts`. Existing projects get `NULL` (ungrouped).

---

## Backend

### New file: `projectGroupService.ts`

- `createGroup(name: string): ProjectGroupRecord` — inserts row, returns record
- `listGroups(): ProjectGroupRecord[]` — returns all groups (no soft delete)

### Updated: `projectService.ts`

- `updateProject(id: number, patch: { groupId: number | null }): ProjectRecord` — updates `group_id`, returns updated record
- `listProjects()` SELECT updated to include `group_id`

### Updated: `ipcHandlers.ts`

| Channel | Handler |
|---|---|
| `group:create` | `createGroup(name)` |
| `group:list` | `listGroups()` |
| `project:update` | `updateProject(id, patch)` |

### Updated: `preload/index.ts` + `types.ts`

New `Api` methods:
```ts
createGroup: (name: string) => Promise<ProjectGroupRecord>
listGroups: () => Promise<ProjectGroupRecord[]>
updateProject: (id: number, patch: { groupId: number | null }) => Promise<ProjectRecord>
```

New type:
```ts
export interface ProjectGroupRecord {
  id: number
  name: string
  created_at: string
}
```

`ProjectRecord` gains `group_id?: number | null`.

---

## Frontend State (App.svelte)

New state:
```ts
let groups = $state<ProjectGroupRecord[]>([])
let activeGroupId = $state<number | null>(null)
```

On mount: load groups alongside projects.

Derived filtered list:
```ts
let filteredProjects = $derived(
  activeGroupId ? projects.filter(p => p.group_id === activeGroupId) : projects
)
```

New handlers:
- `handleGroupSelect(id)` — toggles: if `activeGroupId === id` set null, else set id
- `handleGroupCreated(group)` — appends to `groups`
- `handleProjectUpdated(project)` — patches project in `projects` array

Sidebar receives `filteredProjects` (not `projects`).

---

## Sidebar UI (Sidebar.svelte)

New props: `groups`, `activeGroupId`, `onGroupSelect`, `onRequestNewGroup`, `onGroupCreated`.

### Group strip

Rendered at the bottom of the sidebar, above the waiting section (or at very bottom if no waiting). Separated by a top border.

```
[ A ] [ B ] [ C ] [ + ]
```

- Strip always renders (even with 0 groups — just shows "+")
- One small square icon per group showing first letter (uppercase)
- Styled like existing `.icon-btn`
- Active group: accent border + accent color
- Clicking active group → deselects (shows all projects)
- "+" button: click reveals inline `<input>` auto-focused in place of "+"
  - Enter → `window.api.createGroup(name)` → `onGroupCreated(group)`
  - Escape or blur → cancel, restore "+"
  - Empty name → no-op

### New component: `GroupStrip.svelte`

Extracted into its own component to keep Sidebar under 100 lines.

---

## Project Edit UI (ProjectView.svelte)

In the project header, alongside the Delete button, add a group `<select>` dropdown:

- Options: "No group" (value `""`) + each group by name
- Pre-populated with current `project.group_id`
- `onchange` → `window.api.updateProject(project.id, { groupId })` immediately (no save button)
- On success → `onProjectUpdated(updatedProject)` propagated up to App.svelte

New prop on `ProjectView`: `groups: ProjectGroupRecord[]`, `onProjectUpdated: (p: ProjectRecord) => void`.

---

## Error Handling

- `createGroup`: empty name → client-side guard, no API call
- `updateProject`: failure → toast error, revert select to previous value
- No group rename/delete in this version; projects in a deleted group (future) would become ungrouped via NULL FK

---

## Testing

- Unit tests for `createGroup`, `listGroups`, `updateProject` in backend services
- Unit test for `filteredProjects` derived logic (filter by group_id)
