# Branch Picker for Window Creation

**Date:** 2026-04-17

## Overview

When creating a window, each project gets a branch selector. Default selection is the repo's default branch (current slug behavior preserved). Picking a non-default branch checks it out directly instead of creating a slug branch.

## Data Flow

```
renderer                         main
--------                         ----
NewWindowWizard
  projects confirmed
    → listRemoteBranches(git_url) per project (parallel)
    ← { defaultBranch: "main", branches: ["main", "feat/x", ...] }
  user picks branches per project
  clicks Create Window
    → createWindow(name, ids, withDeps, branchOverrides)
       branchOverrides: Record<projectId, string>
       absent = slug behavior; present = checkout directly

windowService:
  for each project:
    if branchOverrides[id] present
      → clone → checkout that branch directly
    else
      → current slug behavior (clone default → checkoutSlug)
```

## Backend

### gitOps.ts

New function:
```typescript
listRemoteBranches(gitUrl: string, pat: string): Promise<{ defaultBranch: string, branches: string[] }>
```

- Runs `git ls-remote --symref <httpsUrl> HEAD refs/heads/*` once
- Parses `ref: refs/heads/main\tHEAD` line for default branch
- Parses all `refs/heads/foo` lines for branch list
- Returns sorted branch list with default branch first

### windowService.ts

`createWindow` gains optional param `branchOverrides?: Record<number, string>`.

In the project config loop:
- `branchOverrides[projectId]` present → clone → `git checkout <branch>` directly (skip slug logic)
- absent/undefined → existing behavior unchanged (remoteBranchExists check + checkoutSlug)

### ipcHandlers.ts

New handler: `git:list-branches` calls `listRemoteBranches(gitUrl, pat)`.

### preload.ts

New exposure: `window.api.listRemoteBranches(gitUrl): Promise<{ defaultBranch: string, branches: string[] }>`.

## Frontend

### NewWindowWizard.svelte

After projects are confirmed, fetch branches for each project in parallel before enabling "Create Window".

**State:**
- `branchOptions: Record<number, string[]>` — projectId → branch list
- `branchLoading: Record<number, boolean>` — per-project loading state
- `branchSelections: Record<number, string>` — projectId → chosen branch (set to defaultBranch on load)
- `defaultBranches: Record<number, string>` — projectId → default branch name

**UI per project row:**
```
[Project Name]   Branch: [main          ▼]   ← loaded
[Project Name]   Branch: [loading…        ]   ← fetching
[Project Name]   Branch: [(default)       ]   ← fetch failed, disabled
```

**On "Create Window":** build `branchOverrides` containing only projects where `branchSelections[id] !== defaultBranches[id]`. Pass to `createWindow`. Projects with fetch failures are excluded (fallback to slug behavior).

## Error Handling

- Branch fetch fails → log warning, project excluded from `branchOverrides`, falls back to slug behavior silently
- Slow remote / timeout → same fallback
- Selected branch deleted between pick and create → `createWindow` throws, existing error display handles it

## Testing

- `gitOps.test.ts`: `listRemoteBranches` parses symref output correctly; handles missing HEAD symref line; handles empty repo
- `windowService.test.ts`: `branchOverrides` present → direct checkout path called; absent → slug behavior unchanged; mixed (some overridden, some not) works correctly
- `NewWindowWizard.test.ts`: branches load and populate selects; default branch pre-selected; fetch failure shows disabled fallback; only non-default selections passed in `branchOverrides`
