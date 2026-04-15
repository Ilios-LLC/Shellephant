# Git Status Polling + Commit Guard + Summarizer Refocus

**Date:** 2026-04-15  
**Status:** Approved

---

## Overview

Three related changes to the window-manager renderer and supporting shell script:

1. Poll git status per container and display dirty/clean state + line diff counts in the UI
2. Disable the commit button when the working tree is pristine
3. Refocus the Claude summarizer prompt to produce commit-message style output about code changes only

---

## 1. Git Status Polling

### IPC Layer (main process)

New handler `getGitStatus(containerId: string)` in `window-manager/src/main/gitOps.ts`.

Runs two git commands inside the container:

```bash
git status --porcelain          # any output = dirty
git diff --shortstat HEAD       # "+N insertions, -M deletions"
```

Returns: `{ isDirty: boolean, added: number, deleted: number }`

- `isDirty` is true when `git status --porcelain` produces any output (staged, unstaged, or untracked files)
- `added` / `deleted` come from `--shortstat` (0 if clean or no commits yet)
- If the directory is not a git repo, return `{ isDirty: false, added: 0, deleted: 0 }`

Exposed via preload as `window.api.getGitStatus(containerId)`.

### Polling (renderer)

Extended inside `WindowDetailPane.svelte`. The existing 5s `setInterval` that calls `getCurrentBranch` is extended to also call `getGitStatus`. Both results update local state on each tick.

New state:
```ts
let gitStatus = $state<{ isDirty: boolean; added: number; deleted: number } | null>(null);
```

### Display

Footer area of `WindowDetailPane`, alongside the branch name:

- **Dirty:** `main · +12 −5`
- **Clean:** `main (clean)`
- **No status yet:** branch name only (initial render before first poll)

Added/deleted counts are omitted when both are 0 (e.g. only untracked files).

---

## 2. Commit Button Guard

`TerminalHost.svelte` receives `gitStatus` from `WindowDetailPane` (or holds it in its own state since it already owns `commitDisabled`).

Updated disable expression:

```ts
commitDisabled = commitBusy || pushBusy || deleteBusy || !gitStatus?.isDirty
```

Commit button is disabled when:
- Any operation is in progress (existing behavior), OR
- `isDirty` is false (new: pristine working tree)

`gitStatus` state lives in `TerminalHost.svelte` and is updated via a callback prop passed down to `WindowDetailPane` (`onGitStatus`), keeping the existing data-flow pattern.

---

## 3. Summarizer Prompt Refocus

**File:** `window-manager/files/claude-summarize.sh`

Current prompt asks Claude to summarize the conversation into a title + bullets.

New prompt instructs Claude to:
- Ignore conversational content entirely
- Focus only on code changes made during the session
- Produce a conventional-commit style subject (≤50 chars, imperative mood, e.g. `feat: add retry logic to auth handler`)
- Produce ≤5 bullet points describing *what changed* in the code (files touched, behavior added/removed/fixed)
- Output the same `{ "title": "...", "bullets": [...] }` JSON structure so downstream (store, commit modal pre-fill) needs no changes

Example output:
```json
{
  "title": "feat: add git status polling to WindowDetailPane",
  "bullets": [
    "Added getGitStatus IPC handler in gitOps.ts",
    "Extended 5s poll in WindowDetailPane to fetch git status",
    "Commit button disabled when working tree is clean",
    "Updated summarizer prompt to commit-message style"
  ]
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `window-manager/src/main/gitOps.ts` | Add `getGitStatus` function |
| `window-manager/src/preload/index.ts` | Expose `getGitStatus` IPC |
| `window-manager/src/main/index.ts` | Register `getGitStatus` IPC handler |
| `window-manager/src/renderer/src/components/WindowDetailPane.svelte` | Extend poll, display status, fire `onGitStatus` callback |
| `window-manager/src/renderer/src/components/TerminalHost.svelte` | Hold git status state, wire `onGitStatus`, update `commitDisabled` |
| `window-manager/files/claude-summarize.sh` | Update Claude prompt |
| `window-manager/tests/main/gitOps.test.ts` | Unit tests for `getGitStatus` |
| `window-manager/tests/renderer/WindowDetailPane.test.ts` | Tests for status display + poll extension |

---

## Testing

- Unit tests for `getGitStatus`: clean repo, dirty repo (staged), dirty repo (untracked only), non-git directory
- Renderer tests for `WindowDetailPane`: status text rendering (dirty/clean/null), `onGitStatus` callback fires
- Manual: commit button disabled on clean checkout, enabled after editing a file
